import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Auth, signOut } from '@angular/fire/auth';
import {
  Firestore, doc, getDoc,
  collection, query, orderBy, where, getDocs,
  onSnapshot, Unsubscribe
} from '@angular/fire/firestore';
import { CommonModule } from '@angular/common';
// 1. Importamos el Router de Angular
import { RouterModule, Router } from '@angular/router'; 
// 2. Importamos el servicio de notificaciones que creamos
import { NotificacionesService } from '../../services/notificaciones.service';

const ROLES_PERMITIDOS = ['admin', 'recolector', 'usuario'];
const CACHE_DASHBOARD = 'coliapor_dashboard';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css' // Corregí esto, en Angular 17+ es styleUrl o styleUrls
})
export class DashboardComponent implements OnInit, OnDestroy {
  private auth                  = inject(Auth);
  private firestore             = inject(Firestore);
  private router                = inject(Router); // Inyectamos el Router
  private notificacionesService = inject(NotificacionesService); // Inyectamos el servicio

  nombreUsuario    = '';
  esAdmin          = false;
  menuAbierto      = false;
  fechaHoy         = new Date();
  esDiaRecoleccion = false;
  offline          = false;

  // Pagos
  pagoMesPendiente = false;
  montoMensual     = 0;
  tieneMetodoPago  = false;

  // Próxima recolección
  proximaFecha = '';
  proximaHora  = '';

  // Chat
  totalMensajes = 0;
  colonia       = '';
  private unsubChat!: Unsubscribe;

  get clavesMes(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  ngOnInit() {
    this.offline = !navigator.onLine;
    window.addEventListener('online',  () => { this.offline = false; this.cargarDatos(); });
    window.addEventListener('offline', () => { this.offline = true; });

    // Cargar caché inmediatamente
    this.cargarDesdeCache();

    this.auth.onAuthStateChanged(async user => {
      // Cambio: Usar this.router.navigate en lugar de window.location
      if (!user) { this.router.navigate(['/login']); return; } 
      
      await this.cargarDatos();
      this.suscribirChat();

      // 3. ¡Activamos las notificaciones cuando ya sabemos que el usuario está logueado!
      this.notificacionesService.solicitarPermiso();
      this.notificacionesService.escucharMensajesActivos();
    });
  }

  cargarDesdeCache() {
    const raw = localStorage.getItem(CACHE_DASHBOARD);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      this.nombreUsuario    = data.nombreUsuario   || '';
      this.esAdmin          = data.esAdmin         || false;
      this.tieneMetodoPago  = data.tieneMetodoPago || false;
      this.pagoMesPendiente = data.pagoMesPendiente ?? true;
      this.montoMensual     = data.montoMensual    || 0;
      this.proximaFecha     = data.proximaFecha    || '';
      this.proximaHora      = data.proximaHora     || '';
      this.colonia          = data.colonia         || '';
    } catch (e) {}
  }

  guardarEnCache() {
    localStorage.setItem(CACHE_DASHBOARD, JSON.stringify({
      nombreUsuario:    this.nombreUsuario,
      esAdmin:          this.esAdmin,
      tieneMetodoPago:  this.tieneMetodoPago,
      pagoMesPendiente: this.pagoMesPendiente,
      montoMensual:     this.montoMensual,
      proximaFecha:     this.proximaFecha,
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
          // Cambio: Usar this.router.navigate
          this.router.navigate(['/login'], { queryParams: { bloqueado: 'true' } });
          return;
        }

        if (rol && !ROLES_PERMITIDOS.includes(rol)) {
          await signOut(this.auth);
          this.router.navigate(['/login']); // Cambio
          return;
        }

        if (rol === 'recolector') {
          this.router.navigate(['/recolector']); // Cambio crucial para que no recargue la página
          return;
        }

        this.nombreUsuario   = data['nombre'] || user.email || '';
        this.esAdmin         = rol === 'admin';
        this.tieneMetodoPago = !!data['metodoPago'];
        this.colonia         = data['domicilio']?.colonia || data['colonia'] || 'General';

        const pagosMes = data['pagos'] || {};
        this.pagoMesPendiente = !pagosMes[this.clavesMes];
      }

      const configSnap = await getDoc(doc(this.firestore, 'configuracion', 'pagos'));
      if (configSnap.exists()) {
        this.montoMensual = configSnap.data()['montoMensual'] || 0;
      }

      await this.cargarProximaFecha();
      this.guardarEnCache();

    } catch (e) {
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
        this.proximaFecha = fecha.toLocaleDateString('es-MX', {
          weekday: 'long', day: 'numeric', month: 'short'
        });
        this.proximaHora      = proxima['hora'] || '';
        this.esDiaRecoleccion = proxima['fecha'] === hoy;
      }
    } catch (e) {
      console.error('Error cargando próxima fecha:', e);
    }
  }

  suscribirChat() {
    if (!this.colonia) return;
    const ref = collection(this.firestore, 'chat', this.colonia, 'mensajes');
    this.unsubChat = onSnapshot(ref, snap => {
      this.totalMensajes = snap.size;
    });
  }

  toggleMenu() { this.menuAbierto = !this.menuAbierto; }
  cerrarMenu() { this.menuAbierto = false; }

  async cerrarSesion() {
    await signOut(this.auth);
    this.router.navigate(['/login']); // Cambio
  }

  ngOnDestroy() {
    if (this.unsubChat) this.unsubChat();
  }
}