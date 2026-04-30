import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Auth, signOut } from '@angular/fire/auth';
import {
  Firestore, doc, getDoc,
  collection, query, orderBy, where, getDocs,
  onSnapshot, Unsubscribe
} from '@angular/fire/firestore';
import { Database, ref, onValue } from '@angular/fire/database';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { NotificacionesService } from '../../services/notificaciones.service';

const ROLES_PERMITIDOS = ['admin', 'recolector', 'usuario'];
const CACHE_DASHBOARD  = 'coliapor_dashboard';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private rtdb      = inject(Database);
  private router    = inject(Router);
  private notifSvc  = inject(NotificacionesService);

  nombreUsuario    = '';
  esAdmin          = false;
  menuAbierto      = false;
  fechaHoy         = new Date();
  esDiaRecoleccion = false;
  offline          = false;

  pagoMesPendiente = false;
  montoMensual     = 0;
  tieneMetodoPago  = false;

  proximaFecha    = '';
  proximaFechaISO = '';
  proximaHora     = '';

  totalMensajes = 0;
  colonia       = '';

  private domicilioLat: number | null = null;
  private domicilioLng: number | null = null;
  private alerta1km  = false;
  private alerta500m = false;

  private unsubChat!: Unsubscribe;
  private unsubRTDB: (() => void) | null = null;

  get clavesMes(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  ngOnInit() {
    this.offline = !navigator.onLine;
    window.addEventListener('online',  () => { this.offline = false; this.cargarDatos(); });
    window.addEventListener('offline', () => { this.offline = true; });

    this.cargarDesdeCache();

    this.auth.onAuthStateChanged(async user => {
      if (!user) { this.router.navigate(['/login']); return; }
      await this.cargarDatos();
      this.suscribirChat();
    });
  }

  cargarDesdeCache() {
    const raw = localStorage.getItem(CACHE_DASHBOARD);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      this.nombreUsuario    = data.nombreUsuario    || '';
      this.esAdmin          = data.esAdmin          || false;
      this.tieneMetodoPago  = data.tieneMetodoPago  || false;
      this.pagoMesPendiente = data.pagoMesPendiente ?? true;
      this.montoMensual     = data.montoMensual     || 0;
      this.proximaFecha     = data.proximaFecha     || '';
      this.proximaFechaISO  = data.proximaFechaISO  || '';
      this.proximaHora      = data.proximaHora      || '';
      this.colonia          = data.colonia          || '';
    } catch {}
  }

  guardarEnCache() {
    localStorage.setItem(CACHE_DASHBOARD, JSON.stringify({
      nombreUsuario:    this.nombreUsuario,
      esAdmin:          this.esAdmin,
      tieneMetodoPago:  this.tieneMetodoPago,
      pagoMesPendiente: this.pagoMesPendiente,
      montoMensual:     this.montoMensual,
      proximaFecha:     this.proximaFecha,
      proximaFechaISO:  this.proximaFechaISO,
      proximaHora:      this.proximaHora,
      colonia:          this.colonia
    }));
  }

  async cargarDatos() {
    if (!navigator.onLine) return;
    const user = this.auth.currentUser;
    if (!user) return;

    try {
      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      let data: any = null;
      let rol = '';

      if (snap.exists()) {
        data = snap.data();
        rol  = data['rol'] || 'usuario';
      } else {
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

      if (data) {
        if (data['activo'] === false) {
          await signOut(this.auth);
          this.router.navigate(['/login'], { queryParams: { bloqueado: 'true' } });
          return;
        }
        if (rol && !ROLES_PERMITIDOS.includes(rol)) {
          await signOut(this.auth);
          this.router.navigate(['/login']);
          return;
        }
        if (rol === 'recolector') {
          this.router.navigate(['/recolector']);
          return;
        }

        this.nombreUsuario   = data['nombre'] || user.email || '';
        this.esAdmin         = rol === 'admin';
        this.tieneMetodoPago = !!data['metodoPago'];
        this.colonia         = data['domicilio']?.colonia || data['colonia'] || 'General';
        this.domicilioLat    = data['domicilio']?.lat  ?? null;
        this.domicilioLng    = data['domicilio']?.lng  ?? null;

        const pagosMes = data['pagos'] || {};
        this.pagoMesPendiente = !pagosMes[this.clavesMes];

        // Activar notificaciones si el usuario las tiene habilitadas
        if (data['notificacionesActivas']) {
          await this.notifSvc.refrescarToken(user.uid);
          this.notifSvc.escucharForeground();
          this.iniciarProximidad();
          this.verificarNotifDiaAnterior();
          this.verificarPagoProximo(data);
        }
      }

      const configSnap = await getDoc(doc(this.firestore, 'configuracion', 'pagos'));
      if (configSnap.exists()) {
        this.montoMensual = configSnap.data()['montoMensual'] || 0;
      }

      await this.cargarProximaFecha();
      this.guardarEnCache();

    } catch {
      console.warn('Error cargando datos, usando caché.');
    }
  }

  async cargarProximaFecha() {
    try {
      const hoy  = new Date().toISOString().split('T')[0];
      const snap = await getDocs(query(
        collection(this.firestore, 'fechasRecoleccion'),
        orderBy('fecha')
      ));
      const proxima = snap.docs.map(d => d.data()).find(f => f['fecha'] >= hoy);
      if (proxima) {
        const fecha = new Date(proxima['fecha'] + 'T00:00:00');
        this.proximaFecha    = fecha.toLocaleDateString('es-MX', {
          weekday: 'long', day: 'numeric', month: 'short'
        });
        this.proximaFechaISO  = proxima['fecha'] as string;
        this.proximaHora      = proxima['hora']  || '';
        this.esDiaRecoleccion = proxima['fecha'] === hoy;
      }
    } catch (e) {
      console.error('Error cargando próxima fecha:', e);
    }
  }

  // ── Proximidad del camión (RTDB) ──────────────────────────────────────────
  iniciarProximidad() {
    if (!this.domicilioLat || !this.domicilioLng || !this.colonia) return;
    if (this.unsubRTDB) return; // ya suscrito

    const camionesRef = ref(this.rtdb, 'camiones_activos');
    this.unsubRTDB = onValue(camionesRef, snap => {
      const data = snap.val();
      if (!data) return;

      for (const camion of Object.values(data) as any[]) {
        if (camion.colonia !== this.colonia) continue;

        const dist = this.haversineMetros(
          this.domicilioLat!, this.domicilioLng!,
          camion.lat, camion.lng
        );

        if (dist <= 500 && !this.alerta500m) {
          this.alerta500m = true;
          this.notifSvc.mostrarLocal(
            '¡El camión está muy cerca!',
            'El recolector llegará a tu calle en pocos minutos.'
          );
        } else if (dist <= 1000 && !this.alerta1km) {
          this.alerta1km = true;
          this.notifSvc.mostrarLocal(
            'El camión se acerca',
            'El recolector está a menos de 1 km de tu domicilio.'
          );
        }
      }
    });
  }

  private haversineMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R  = 6371000;
    const f1 = lat1 * Math.PI / 180;
    const f2 = lat2 * Math.PI / 180;
    const df = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const a  = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Aviso local: día anterior a recolección ───────────────────────────────
  verificarNotifDiaAnterior() {
    if (!this.proximaFechaISO) return;
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().split('T')[0];

    if (this.proximaFechaISO !== mananaStr) return;

    const clave = `notif_dia_anterior_${mananaStr}`;
    if (localStorage.getItem(clave)) return;
    localStorage.setItem(clave, '1');

    this.notifSvc.mostrarLocal(
      'Recolección mañana',
      `Mañana hay recolección${this.proximaHora ? ' a las ' + this.proximaHora : ''} en tu colonia.`
    );
  }

  // ── Aviso local: pago próximo a vencer (30 días desde último pago) ────────
  verificarPagoProximo(userData: any) {
    const pagos = userData['pagos'] || {};
    const claves = Object.keys(pagos).sort().reverse();
    if (!claves.length) return;

    const ultimoPago = pagos[claves[0]];
    // Soporte para fechaISO (nuevo) y fecha string 'dd/mm/yyyy' (legado)
    let fechaPago: Date | null = null;
    if (ultimoPago?.fechaISO) {
      fechaPago = new Date(ultimoPago.fechaISO + 'T00:00:00');
    } else if (ultimoPago?.fecha) {
      const [dd, mm, yyyy] = (ultimoPago.fecha as string).split('/');
      if (dd && mm && yyyy) fechaPago = new Date(+yyyy, +mm - 1, +dd);
    }
    if (!fechaPago || isNaN(fechaPago.getTime())) return;

    const vencimiento    = new Date(fechaPago.getTime() + 30 * 24 * 60 * 60 * 1000);
    const diasRestantes  = Math.ceil((vencimiento.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (diasRestantes >= 1 && diasRestantes <= 5) {
      const clave = `notif_pago_${claves[0]}`;
      if (localStorage.getItem(clave)) return;
      localStorage.setItem(clave, '1');

      this.notifSvc.mostrarLocal(
        'Pago próximo a vencer',
        `Tu suscripción vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}. Realiza tu pago a tiempo.`
      );
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  suscribirChat() {
    if (!this.colonia) return;
    const chatRef = collection(this.firestore, 'chat', this.colonia, 'mensajes');
    this.unsubChat = onSnapshot(chatRef, snap => {
      this.totalMensajes = snap.size;
    });
  }

  toggleMenu() { this.menuAbierto = !this.menuAbierto; }
  cerrarMenu()  { this.menuAbierto = false; }

  async cerrarSesion() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }

  ngOnDestroy() {
    if (this.unsubChat)  this.unsubChat();
    if (this.unsubRTDB)  this.unsubRTDB();
  }
}
