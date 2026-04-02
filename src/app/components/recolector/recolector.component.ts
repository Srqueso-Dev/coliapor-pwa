import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';
import { Firestore, doc, getDoc, collection, query, where, getDocs, onSnapshot } from '@angular/fire/firestore';
import { Database, ref, set, remove, onDisconnect } from '@angular/fire/database';
import { ToastService } from '../toast/toast.service';
import * as L from 'leaflet';
import { COLONIAS_TONALA } from '../onboarding/onboarding.component';

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
  private rtdb      = inject(Database);
  private toast     = inject(ToastService);

  nombre   = '';
  colonia  = '';
  uid      = '';
  rol      = '';
  cargando = true;
  colonias = COLONIAS_TONALA;

  // Camión
  camion: any = null;
  private unsubCamion: (() => void) | null = null;

  // Fechas
  fechasColonia: any[] = [];

  // Mapa
  private mapa!: L.Map;
  private capaMarcadores!: L.LayerGroup;
  private pinRecolector!: L.Marker;
  private lineaRuta: L.Polyline | null = null;
  private watchId: number | null = null;
  mapaActivo    = false;
  enRuta        = false;
  usuariosGeo: any[] = [];

  // Variables de Simulación (Solo Admin)
  simulacionVelocidad: number = 30; 
  simulacionColonia: string = '';
  puntoSalida: [number, number] | null = null;
  modoSeleccionMapa: boolean = false;
  cargandoRuta: boolean = false;
  private simuladorInterval: any;
  private indiceSimulacion = 0;
  private rutaSimulada: [number, number][] = [];

  // Variables RTDB
  private transmisionActiva = false;
  private ultimoEnvioRTDB = 0;

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
      this.simulacionColonia = this.colonia; 

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
    if (!this.simulacionColonia) return;
    const snap = await getDocs(collection(this.firestore, 'usuarios'));
    this.usuariosGeo = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((u: any) =>
        u.domicilio?.lat &&
        u.domicilio?.lng &&
        u.domicilio?.colonia === this.simulacionColonia
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

    this.mapa.on('click', (e: L.LeafletMouseEvent) => {
      if (this.modoSeleccionMapa && this.rol === 'admin') {
        this.puntoSalida = [e.latlng.lat, e.latlng.lng];
        this.modoSeleccionMapa = false; 
        this.toast.ok('Punto de salida fijado');
        
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
      this.mapa.setView([u.domicilio.lat, u.domicilio.lng], 16);
    }
  }

  crearIconoRecolector() {
    return L.divIcon({
      className: '',
      html: `<div class="pin-recolector" style="width: 30px; height: 30px;">
               <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; transform: rotate(45deg); fill: white;"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4z"/></svg>
             </div>`,
      iconSize: [30, 30], 
      iconAnchor: [15, 15] 
    });
  }

  // ── Firebase Realtime Database ────────────────────────
  async transmitirUbicacion(lat: number, lng: number) {
    const ahora = Date.now();
    // Throttle: Limita el envío a 1 vez cada 2 segundos.
    if (ahora - this.ultimoEnvioRTDB < 2000) return; 
    this.ultimoEnvioRTDB = ahora;

    const ubicacionRef = ref(this.rtdb, `camiones_activos/${this.uid}`);
    
    if (!this.transmisionActiva) {
      // Si la app se cierra, Firebase borra automáticamente este nodo
      onDisconnect(ubicacionRef).remove();
      this.transmisionActiva = true;
    }
    
    await set(ubicacionRef, { 
      lat, 
      lng, 
      timestamp: ahora,
      colonia: this.simulacionColonia || this.colonia,
      rol: this.rol
    });
  }

  async detenerTransmision() {
    if (this.transmisionActiva) {
      const ubicacionRef = ref(this.rtdb, `camiones_activos/${this.uid}`);
      await remove(ubicacionRef);
      onDisconnect(ubicacionRef).cancel(); 
      this.transmisionActiva = false;
    }
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
      
      // Enviar a Realtime Database
      this.transmitirUbicacion(lat, lng);

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

  async actualizarColoniaSimulacion(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.simulacionColonia = select.value;
    
    await this.cargarUsuariosColonia();
    this.pintarCasasColonia();

    this.puntoSalida = null;
    if (this.pinRecolector && this.mapa) {
      this.mapa.removeLayer(this.pinRecolector);
      (this.pinRecolector as any) = null;
    }
    if (this.lineaRuta && this.mapa) {
      this.mapa.removeLayer(this.lineaRuta);
      this.lineaRuta = null;
    }
  }

  async calcularRutaOSRM(): Promise<[number, number][]> {
    const coordenadas = [];
    coordenadas.push(`${this.puntoSalida![1]},${this.puntoSalida![0]}`); 

    const casasLimitadas = this.usuariosGeo.slice(0, 90);
    casasLimitadas.forEach(u => {
      coordenadas.push(`${u.domicilio.lng},${u.domicilio.lat}`);
    });

    const coordString = coordenadas.join(';');
    // &overview=full para obtener la geometría detallada calle por calle
    const url = `https://router.project-osrm.org/trip/v1/driving/${coordString}?roundtrip=false&source=first&geometries=geojson&overview=full`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 'Ok') throw new Error('OSRM no pudo calcular la ruta');

    const geometry = data.trips[0].geometry.coordinates;
    return geometry.map((punto: any) => [punto[1], punto[0]]);
  }

  async iniciarSimulacion() {
    if (this.usuariosGeo.length === 0) {
      this.toast.info('No es necesario entrar en ruta');
      return;
    }

    if (!this.puntoSalida) {
      this.toast.error('Debes seleccionar un punto de salida en el mapa primero.');
      return;
    }

    this.cargandoRuta = true;

    try {
      this.rutaSimulada = await this.calcularRutaOSRM();
      
      if (this.lineaRuta) this.mapa.removeLayer(this.lineaRuta);
      this.lineaRuta = L.polyline(this.rutaSimulada, { 
        color: '#2196F3', weight: 4, opacity: 0.8 
      }).addTo(this.mapa);

      this.enRuta = true;
      this.indiceSimulacion = 0;
      
      // Ajuste de velocidad para los cientos de puntos detallados que devuelve OSRM
      const delayVelocidad = Math.max(80, (10000 / this.simulacionVelocidad));

      this.simuladorInterval = setInterval(() => {
        this.indiceSimulacion++;
        
        if (this.indiceSimulacion >= this.rutaSimulada.length) {
          this.detenerRuta();
          this.toast.ok('Simulación terminada. Ruta completada.');
          return;
        }

        const nuevasCoords = this.rutaSimulada[this.indiceSimulacion];
        this.pinRecolector.setLatLng(nuevasCoords);
        
        // Centrar la cámara suavemente cada ciertos puntos
        if (this.indiceSimulacion % 8 === 0) {
          this.mapa.panTo(nuevasCoords, { animate: true, duration: 0.5 }); 
        }

        // Enviar a Realtime Database (Se mantiene el throttle de 2 segundos internamente)
        this.transmitirUbicacion(nuevasCoords[0], nuevasCoords[1]);
        
      }, delayVelocidad);

    } catch (error) {
      console.error(error);
      this.toast.error('Error al calcular la ruta. Verifica tu conexión.');
    } finally {
      this.cargandoRuta = false;
    }
  }

  detenerRuta() {
    this.enRuta = false;
    this.modoSeleccionMapa = false;
    
    // Detener servicios de RTDB
    this.detenerTransmision();

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

    if (this.lineaRuta && this.mapa) {
      this.mapa.removeLayer(this.lineaRuta);
      this.lineaRuta = null;
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