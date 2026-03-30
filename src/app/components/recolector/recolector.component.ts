import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';
import { Firestore, doc, getDoc, collection, query, where, getDocs, onSnapshot } from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';
import * as L from 'leaflet';

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
  zona     = '';
  uid      = '';
  rol      = '';
  cargando = true;

  camion: any       = null;
  private unsubCamion: (() => void) | null = null;

  fechasZona: any[] = [];

  private mapa!: L.Map;
  private pinRecolector!: L.Marker;
  mapaActivo = false;

  ngOnInit() {
    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      this.uid = user.uid;

      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      if (!snap.exists()) { window.location.href = '/login'; return; }

      const data = snap.data();
      this.rol = data['rol'] || '';

      // Solo admin y recolector pueden entrar
      if (this.rol !== 'recolector' && this.rol !== 'admin') {
        window.location.href = '/dashboard';
        return;
      }

      this.nombre = data['nombre'] || '';
      this.zona   = data['zona']   || '';

      await Promise.all([
        this.cargarCamion(user.uid),
        this.cargarFechasZona()
      ]);

      this.cargando = false;
    });
  }

  ngOnDestroy() {
    if (this.unsubCamion) this.unsubCamion();
    if (this.mapa) this.mapa.remove();
  }

  async cargarCamion(uid: string) {
    const snap = await getDocs(query(
      collection(this.firestore, 'camiones'),
      where('recolectorId', '==', uid)
    ));
    if (snap.empty) { this.camion = null; return; }

    const camionDoc = snap.docs[0];
    this.unsubCamion = onSnapshot(doc(this.firestore, 'camiones', camionDoc.id), s => {
      if (s.exists()) this.camion = { id: s.id, ...s.data() };
    });
  }

  async cargarFechasZona() {
    if (!this.zona) return;
    const hoy  = new Date().toISOString().split('T')[0];
    const snap = await getDocs(collection(this.firestore, 'fechasRecoleccion'));
    this.fechasZona = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((f: any) => f.fecha >= hoy && f.zona === this.zona)
      .sort((a: any, b: any) => a.fecha.localeCompare(b.fecha))
      .slice(0, 5);
  }

  get estadoCamionColor(): string {
    if (!this.camion) return '#aaa';
    if (this.camion.estado === 'servicio')      return '#00E676';
    if (this.camion.estado === 'mantenimiento') return '#FF6B00';
    return '#aaa';
  }

  get estadoCamionLabel(): string {
    if (!this.camion) return '—';
    const estados: any = { servicio: 'En servicio', mantenimiento: 'En mantenimiento', apagado: 'Apagado' };
    return estados[this.camion.estado] || this.camion.estado;
  }

  toggleMapa() {
    this.mapaActivo = !this.mapaActivo;
    if (this.mapaActivo) {
      setTimeout(() => this.iniciarMapa(), 300);
    } else {
      if (this.mapa) { this.mapa.remove(); (this.mapa as any) = null; }
    }
  }

  iniciarMapa() {
    if (this.mapa) { this.mapa.invalidateSize(); return; }
    this.mapa = L.map('mapa-recolector').setView([20.6534, -103.2340], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 21
    }).addTo(this.mapa);

    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (this.pinRecolector) {
          this.pinRecolector.setLatLng([lat, lng]);
        } else {
          const icono = L.divIcon({
            className: '',
            html: `<div class="pin-recolector">
                     <svg viewBox="0 0 24 24"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4z"/></svg>
                   </div>`,
            iconSize: [44, 44], iconAnchor: [22, 44]
          });
          this.pinRecolector = L.marker([lat, lng], { icon: icono }).addTo(this.mapa);
          this.mapa.setView([lat, lng], 17);
        }
      });
    }
  }

  async cerrarSesion() {
    const ok = await this.toast.confirmar('¿Cerrar sesión?');
    if (!ok) return;
    await signOut(this.auth);
    window.location.href = '/login';
  }

  formatearFecha(fecha: string): string {
    if (!fecha) return '—';
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y}`;
  }
}