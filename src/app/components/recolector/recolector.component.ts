import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';
import { Firestore, doc, getDoc, collection, query, where, getDocs, onSnapshot, updateDoc } from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';

@Component({
  selector: 'app-recolector',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './recolector.component.html',
  styleUrl: './recolector.component.css'
})
export class RecolectorComponent implements OnInit, OnDestroy {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private toast     = inject(ToastService);

  nombre   = '';
  colonia  = '';
  uid      = '';
  cargando = true;

  camion: any = null;
  private unsubCamion: (() => void) | null = null;

  // ── Motor de Ruta (Sin mapas) ──
  casasEnRuta: any[] = [];
  indiceParada = 0;
  enRuta = false;

  ngOnInit() {
    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      this.uid = user.uid;

      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      if (!snap.exists()) { window.location.href = '/login'; return; }

      const data = snap.data();
      const rol = data['rol'] || '';

      if (rol === 'admin') { window.location.href = '/simulacion'; return; }
      if (rol !== 'recolector') { window.location.href = '/dashboard'; return; }

      this.nombre  = data['nombre']  || '';
      this.colonia = data['colonia'] || '';

      await Promise.all([
        this.cargarCamion(user.uid),
        this.cargarRuta()
      ]);
      
      this.cargando = false;
    });
  }

  ngOnDestroy() {
    if (this.unsubCamion) this.unsubCamion();
  }

  // ── Camión y Sensores (ESP32) ──
  async cargarCamion(uid: string) {
    const snap = await getDocs(query(collection(this.firestore, 'camiones'), where('recolectorId', '==', uid)));
    if (snap.empty) { this.camion = null; return; }
    
    const camionDoc = snap.docs[0];
    this.unsubCamion = onSnapshot(doc(this.firestore, 'camiones', camionDoc.id), s => {
      if (s.exists()) this.camion = { id: s.id, ...s.data() };
    });
  }

  async calibrarCero() {
    const ok = await this.toast.confirmar('¿Calibrar celda de carga a 0 kg?');
    if (!ok || !this.camion) return;
    try {
      await updateDoc(doc(this.firestore, 'camiones', this.camion.id), { 
        pesoActual: 0, 
        contenedorLleno: false 
      });
      this.toast.ok('Báscula calibrada a 0.');
    } catch {
      this.toast.error('Error al calibrar.');
    }
  }

  async reporteRapido(estado: string, mensaje: string) {
    if (!this.camion) return;
    try {
      await updateDoc(doc(this.firestore, 'camiones', this.camion.id), { estado });
      this.toast.info(mensaje);
    } catch {
      this.toast.error('Error al enviar reporte.');
    }
  }

  // ── Lógica de Ruta Lineal ──
  async cargarRuta() {
    const snap = await getDocs(collection(this.firestore, 'usuarios'));
    // Filtramos usuarios que pertenezcan a la colonia del recolector
    this.casasEnRuta = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((u: any) => u.domicilio?.colonia === this.colonia && u.domicilio?.calle);
  }

  get paradaActual() {
    return this.casasEnRuta[this.indiceParada] || null;
  }

  async iniciarRuta() {
    if (this.casasEnRuta.length === 0) {
      this.toast.error('No hay casas registradas en esta colonia.');
      return;
    }
    this.enRuta = true;
    this.indiceParada = 0;
    if (this.camion) {
      await updateDoc(doc(this.firestore, 'camiones', this.camion.id), { estado: 'servicio' });
    }
    this.toast.ok('Ruta iniciada. ¡Buen viaje!');
  }

  async marcarRecolectado() {
    if (this.indiceParada < this.casasEnRuta.length - 1) {
      this.indiceParada++;
      // Aquí en un futuro podrías guardar en Firestore que esta casa específica ya se recolectó
    } else {
      this.enRuta = false;
      if (this.camion) {
        await updateDoc(doc(this.firestore, 'camiones', this.camion.id), { estado: 'apagado' });
      }
      this.toast.ok('¡Has completado toda la colonia!');
    }
  }

  async cerrarSesion() {
    const ok = await this.toast.confirmar('¿Terminar turno y salir?');
    if (!ok) return;
    await signOut(this.auth);
    window.location.href = '/login';
  }
}