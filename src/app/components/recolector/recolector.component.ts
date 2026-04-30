import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router'; // <-- Router importado
import { Auth, signOut } from '@angular/fire/auth';
import { Firestore, doc, getDoc, collection, query, where, getDocs, onSnapshot, updateDoc } from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';
import { NotificacionesService } from '../../services/notificaciones.service'; // <-- Servicio importado

@Component({
  selector: 'app-recolector',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './recolector.component.html',
  styleUrl: './recolector.component.css'
})
export class RecolectorComponent implements OnInit, OnDestroy {
  private auth                  = inject(Auth);
  private firestore             = inject(Firestore);
  private toast                 = inject(ToastService);
  private router                = inject(Router); // <-- Inyectamos Router
  private notificacionesService = inject(NotificacionesService); // <-- Inyectamos Notificaciones

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
      if (!user) { this.router.navigate(['/login']); return; } // <-- Navegación SPA
      this.uid = user.uid;

      let data: any = null;
      let rol = '';

      // 1. Intentar localizar al usuario en la colección 'usuarios'
      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      if (snap.exists()) {
        data = snap.data();
        rol  = data['rol'] || '';
      } else {
        // 2. Fallback: buscar en 'recolectores' por email
        //    (los recolectores se crean con addDoc, no comparten UID con Auth)
        const userEmail = (user.email || '').toLowerCase();
        if (userEmail) {
          const recQuery = await getDocs(query(
            collection(this.firestore, 'recolectores'),
            where('email', '==', userEmail)
          ));
          if (!recQuery.empty) {
            data = recQuery.docs[0].data();
            rol  = data?.['rol'] || 'recolector';
          }
        }
      }

      // Si la cuenta fue desactivada, sacarlo
      if (data && data['activo'] === false) {
        this.router.navigate(['/login'], { queryParams: { bloqueado: 'true' } }); // <-- Navegación con parámetros
        return;
      }

      // Validación de rol — solo admin y recolector pueden ver esta vista
      const ROLES_PERMITIDOS = ['admin', 'recolector'];
      if (!data || !ROLES_PERMITIDOS.includes(rol)) {
        this.router.navigate(['/dashboard']); // <-- Navegación SPA
        return;
      }
      if (rol === 'admin') { this.router.navigate(['/simulacion']); return; } // <-- Navegación SPA

      this.nombre  = data['nombre']  || '';
      this.colonia = data['colonia'] || '';

      await Promise.all([
        this.cargarCamion(user.uid),
        this.cargarRuta()
      ]);

      this.cargando = false;

      // 3. ¡Activamos las notificaciones una vez que el perfil cargó!
      this.notificacionesService.solicitarPermiso();
      this.notificacionesService.escucharMensajesActivos();
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
    this.router.navigate(['/login']); // <-- Navegación SPA
  }
}