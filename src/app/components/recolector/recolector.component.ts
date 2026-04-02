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
  colonia  = '';
  uid      = '';
  rol      = '';
  cargando = true;

  // Camión
  camion: any = null;
  private unsubCamion: (() => void) | null = null;

  // Fechas
  fechasColonia: any[] = [];

  // Mapa
  private mapa!: L.Map;
  private capaMarcadores!: L.LayerGroup;
  private pinRecolector!: L.Marker;
  private watchId: number | null = null;
  mapaActivo    = false;
  enRuta        = false;
  usuariosGeo: any[] = [];

  // Variables de Simulación (Solo Admin)
  simulacionVelocidad: number = 30; // km/h por defecto
  simulacionColonia: string = '';
  puntoSalida: [number, number] | null = null;
  modoSeleccionMapa: boolean = false;
  private simuladorInterval: any;
  private indiceSimulacion = 0;
  
  // Ruta de prueba (En el futuro esto vendrá de OSRM)
  private rutaSimulada: [number, number][] = [
    [20.6534, -103.2340],
    [20.6540, -103.2340],
    [20.6540, -103.2350],
    [20.6530, -103.2350],
    [20.6530, -103.2340]
  ];

  ngOnInit() {
    this.auth.onAuthStateChanged(async user => {
      if (!user) { this.irAlLogin(); return; }
      this.uid = user.uid;

      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      if (!snap.exists()) { this.irAlLogin(); return; }

      const data = snap.data();
      this.rol = data['rol'] || '';

      if (this.rol !== 'recolector' && this.rol !== 'admin') {
        window.location.href = '/dashboard';
        return;
      }

      this.nombre  = data['nombre']  || '';
      this.colonia = data['colonia'] || '';
      this.simulacionColonia = this.colonia; // Pre-llenar para el admin

      await Promise.all([
        this.cargarCamion(user.uid),
        this.cargarFechasColonia(),
        this.cargarUsuariosColonia()
      ]);

      this.cargando = false;
    });
  }

  ngOnDestroy() {
    if (this.unsubCamion) this.unsubCamion();
    if (this.mapa) this.mapa.remove();
    this.detenerRuta();
  }

  irAlLogin() {
    window.location.href = '/login';
  }

  // ── Camión ────────────────────────────────────────────
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

  get estadoCamionColor(): string {
    if (!this.camion) return '#aaa';
    if (this.camion.estado === 'servicio')      return '#00E676';
    if (this.camion.estado === 'mantenimiento') return '#FF6B00';
    return '#aaa';
  }

  get estadoCamionLabel(): string {
    if (!this.camion) return '—';
    const map: any = { servicio: 'En servicio', mantenimiento: 'En mantenimiento', apagado: 'Apagado' };
    return map[this.camion.estado] || this.camion.estado;
  }

  // ── Fechas ────────────────────────────────────────────
  async cargarFechasColonia() {
    if (!this.colonia) return;
    const hoy  = new Date().toISOString().split('T')[0];
    const snap = await getDocs(collection(this.firestore, 'fechasRecoleccion'));
    this.fechasColonia = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((f: any) => f.fecha >= hoy && f.colonia === this.colonia)
      .sort((a: any, b: any) => a.fecha.localeCompare(b.fecha))
      .slice(0, 5);
  }

  // ── Usuarios de la colonia (para el mapa) ─────────────
  async cargarUsuariosColonia() {
    if (!this.colonia) return;
    const snap = await getDocs(collection(this.firestore, 'usuarios'));
    this.usuariosGeo = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((u: any) =>
        u.domicilio?.lat &&
        u.domicilio?.lng &&
        u.domicilio?.colonia === this.colonia
      );
  }

  get clavesMes(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  pagoClave(usuario: any): boolean {
    return !!(usuario.pagos && usuario.pagos[this.clavesMes]);
  }

  // ── Mapa ──────────────────────────────────────────────
  toggleMapa() {
    this.mapaActivo = !this.mapaActivo;
    if (this.mapaActivo) {
      setTimeout(() => this.iniciarMapa(), 300);
    } else {
      this.detenerRuta();
      if (this.mapa) { this.mapa.remove(); (this.mapa as any) = null; }
    }
  }

  iniciarMapa() {
    if (this.mapa) { this.mapa.invalidateSize(); return; }

    this.mapa = L.map('mapa-recolector').setView([20.6534, -103.2340], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 21
    }).addTo(this.mapa);

    this.capaMarcadores = L.layerGroup().addTo(this.mapa);
    this.pintarCasasColonia();

    // Evento de clic en el mapa (Solo útil para el admin en modo simulación)
    this.mapa.on('click', (e: L.LeafletMouseEvent) => {
      if (this.modoSeleccionMapa && this.rol === 'admin') {
        this.puntoSalida = [e.latlng.lat, e.latlng.lng];
        this.modoSeleccionMapa = false; // Apagar el modo selección tras hacer clic
        this.toast.ok('Punto de salida fijado');
        
        // Poner el pin de inicio simulado
        const iconoRecolector = this.crearIconoRecolector();
        if (this.pinRecolector) {
          this.pinRecolector.setLatLng(this.puntoSalida);
        } else {
          this.pinRecolector = L.marker(this.puntoSalida, { icon: iconoRecolector }).addTo(this.mapa);
        }
      }
    });
  }

  pintarCasasColonia() {
    if (!this.mapa || !this.capaMarcadores) return;
    this.capaMarcadores.clearLayers();

    this.usuariosGeo.forEach(u => {
      const pagado = this.pagoClave(u);
      const color  = pagado ? '#00E676' : '#FF6B00';
      const borde  = pagado ? '#00a152' : '#c44000';
      const numero = u.domicilio?.numero || '?';

      const icono = L.divIcon({
        className: '',
        html: `<div class="pin-casa" style="background:${color};border-color:${borde};">
                 <span>${numero}</span>
                 <div class="pin-punta" style="border-top-color:${color};"></div>
               </div>`,
        iconSize: [38, 44], iconAnchor: [19, 44]
      });

      const marker = L.marker([u.domicilio.lat, u.domicilio.lng], { icon: icono })
        .bindPopup(`
          <b>${u.nombre || '—'}</b><br>
          ${u.domicilio.calle} ${u.domicilio.numero}<br>
          <span style="color:${color};font-weight:700;">
            ${pagado ? '✓ Pagó este mes' : '⚠ Pendiente de pago'}
          </span>
        `);

      this.capaMarcadores.addLayer(marker);
    });

    if (this.usuariosGeo.length > 0) {
      const u = this.usuariosGeo[0];
      this.mapa.setView([u.domicilio.lat, u.domicilio.lng], 17);
    }
  }

  crearIconoRecolector() {
    return L.divIcon({
      className: '',
      html: `<div class="pin-recolector">
               <svg viewBox="0 0 24 24"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4z"/></svg>
             </div>`,
      iconSize: [44, 44], iconAnchor: [22, 44]
    });
  }

  // ── GPS Real (Solo Recolector) ────────────────────────
  iniciarRuta() {
    this.enRuta = true;
    if (!navigator.geolocation) {
      this.toast.error('Tu dispositivo no soporta geolocalización.');
      this.enRuta = false;
      return;
    }

    const iconoRecolector = this.crearIconoRecolector();

    this.watchId = navigator.geolocation.watchPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      if (this.pinRecolector) {
        this.pinRecolector.setLatLng([lat, lng]);
      } else {
        this.pinRecolector = L.marker([lat, lng], { icon: iconoRecolector })
          .bindPopup('Tu ubicación actual')
          .addTo(this.mapa);
      }
      this.mapa.setView([lat, lng], 17);
    }, () => {
      this.toast.error('No se pudo obtener tu ubicación.');
    }, { enableHighAccuracy: true });
  }

  // ── Simulación (Solo Admin) ───────────────────────────
  activarSeleccionMapa() {
    this.modoSeleccionMapa = true;
    this.toast.info('Haz clic en el mapa para fijar el punto de salida.');
  }

  cambiarVelocidad(event: Event) {
    const input = event.target as HTMLInputElement;
    this.simulacionVelocidad = Number(input.value);
  }

  actualizarColoniaSimulacion(event: Event) {
    const input = event.target as HTMLInputElement;
    this.simulacionColonia = input.value;
  }

  iniciarSimulacion() {
    if (!this.puntoSalida) {
      this.toast.error('Debes seleccionar un punto de salida en el mapa primero.');
      return;
    }

    this.enRuta = true;
    this.indiceSimulacion = 0;
    
    // Inyectar el punto de salida real como inicio de la ruta simulada
    this.rutaSimulada[0] = this.puntoSalida;

    const delayVelocidad = Math.max(500, (60000 / this.simulacionVelocidad));

    this.simuladorInterval = setInterval(() => {
      this.indiceSimulacion++;
      
      if (this.indiceSimulacion >= this.rutaSimulada.length) {
        this.indiceSimulacion = 0; 
      }

      const nuevasCoords = this.rutaSimulada[this.indiceSimulacion];
      this.pinRecolector.setLatLng(nuevasCoords);
      this.mapa.panTo(nuevasCoords); 
      
    }, delayVelocidad);
  }

  detenerRuta() {
    this.enRuta = false;
    this.modoSeleccionMapa = false;
    
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    
    if (this.simuladorInterval) {
      clearInterval(this.simuladorInterval);
      this.simuladorInterval = null;
    }

    if (this.pinRecolector && this.mapa) {
      this.mapa.removeLayer(this.pinRecolector);
      (this.pinRecolector as any) = null;
    }
  }

  async cerrarSesion() {
    await signOut(this.auth);
    window.location.href = '/login';
  }

  formatearFecha(fecha: string): string {
    if (!fecha) return '—';
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y}`;
  }
}