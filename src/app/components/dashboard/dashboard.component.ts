import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Auth, signOut } from '@angular/fire/auth';
import {
  Firestore, doc, getDoc,
  collection, query, orderBy, where, getDocs,
  onSnapshot, Unsubscribe
} from '@angular/fire/firestore';

// Roles que pueden acceder al dashboard
const ROLES_PERMITIDOS = ['admin', 'recolector', 'usuario'];
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

const CACHE_DASHBOARD = 'coliapor_dashboard';

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
      if (!user) { window.location.href = '/login'; return; }
      await this.cargarDatos();
      this.suscribirChat();
    });
  }

  cargarDesdeCache() {
    const raw = localStorage.getItem(CACHE_DASHBOARD);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      this.nombreUsuario   = data.nombreUsuario   || '';
      this.esAdmin         = data.esAdmin         || false;
      this.tieneMetodoPago = data.tieneMetodoPago || false;
      this.pagoMesPendiente = data.pagoMesPendiente ?? true;
      this.montoMensual    = data.montoMensual    || 0;
      this.proximaFecha    = data.proximaFecha    || '';
      this.proximaHora     = data.proximaHora     || '';
      this.colonia         = data.colonia         || '';
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
        // Fallback: buscar en 'recolectores' por email
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
          window.location.href = '/login?bloqueado=true';
          return;
        }

        // Validación de rol: si el rol no está permitido, sacarlo al login
        if (rol && !ROLES_PERMITIDOS.includes(rol)) {
          await signOut(this.auth);
          window.location.href = '/login';
          return;
        }

        // Si es recolector, redirigir a su panel propio
        if (rol === 'recolector') {
          window.location.href = '/recolector';
          return;
        }

        this.nombreUsuario   = data['nombre'] || user.email || '';
        this.esAdmin         = rol === 'admin';
        this.tieneMetodoPago = !!data['metodoPago'];
        this.colonia         = data['domicilio']?.colonia || data['colonia'] || 'General';

        const pagosMes = data['pagos'] || {};
        this.pagoMesPendiente = !pagosMes[this.clavesMes];
      }

      // Monto mensual
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
    window.location.href = '/login';
  }

  ngOnDestroy() {
    if (this.unsubChat) this.unsubChat();
  }
} 