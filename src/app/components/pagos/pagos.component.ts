import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import {
  Firestore, doc, getDoc, setDoc, addDoc,
  collection, getDocs, query, orderBy, limit
} from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';

@Component({
  selector: 'app-pagos',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './pagos.component.html',
  styleUrl: './pagos.component.css'
})
export class PagosComponent implements OnInit {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private toast     = inject(ToastService);

  tipoUsuario  = '';
  uid          = '';
  nombre       = '';
  metodoPago: any  = null;
  pagadoEsteMes    = false;
  montoMensual     = 0;
  historial: any[] = [];
  cargando         = true;
  procesando       = false;

  get clavesMes(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  get mesActualStr(): string {
    const now = new Date();
    const mes = now.toLocaleString('es-MX', { month: 'long' });
    return `${mes.charAt(0).toUpperCase() + mes.slice(1)} ${now.getFullYear()}`;
  }

  ngOnInit() {
    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      this.uid = user.uid;
      await this.cargarDatos();
    });
  }

  async cargarDatos() {
    this.cargando = true;
    try {
      const [snapUsuario, snapConfig] = await Promise.all([
        getDoc(doc(this.firestore, 'usuarios', this.uid)),
        getDoc(doc(this.firestore, 'configuracion', 'pagos'))
      ]);

      if (snapUsuario.exists()) {
        const data = snapUsuario.data();
        this.tipoUsuario   = data['tipoUsuario'] || 'residente';
        this.nombre        = data['nombre']       || '';
        this.metodoPago    = data['metodoPago']   || null;
        this.pagadoEsteMes = !!(data['pagos']?.[this.clavesMes]);
      }

      if (snapConfig.exists()) {
        this.montoMensual = snapConfig.data()['montoMensual'] || 0;
      }

      const snapHistorial = await getDocs(query(
        collection(this.firestore, `usuarios/${this.uid}/historialPagos`),
        orderBy('fecha', 'desc'), limit(6)
      ));
      this.historial = snapHistorial.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
      this.toast.error('Error al cargar los datos. Recarga la página.');
    } finally {
      this.cargando = false;
    }
  }

  async registrarPago() {
    if (!this.metodoPago) {
      this.toast.error('No tienes un método de pago registrado. Ve a tu perfil para agregar uno.');
      return;
    }
    if (this.pagadoEsteMes) {
      this.toast.info('Ya realizaste el pago de este mes.');
      return;
    }

    this.procesando = true;
    try {
      const fechaStr = new Date().toLocaleDateString('es-MX');
      const metodoStr = `${this.metodoPago.marca} ••••${this.metodoPago.ultimos4}`;

      await addDoc(collection(this.firestore, `usuarios/${this.uid}/historialPagos`), {
        mes:    this.mesActualStr,
        monto:  this.montoMensual,
        fecha:  fechaStr,
        metodo: metodoStr,
        estado: 'pagado'
      });

      await setDoc(doc(this.firestore, 'usuarios', this.uid), {
        pagos: { [this.clavesMes]: {
          fecha:    fechaStr,
          fechaISO: new Date().toISOString().split('T')[0],
          monto:    this.montoMensual,
          estado:   'pagado'
        }}
      }, { merge: true });

      await addDoc(collection(this.firestore, 'pagos'), {
        uid:      this.uid,
        nombre:   this.nombre,
        mes:      this.mesActualStr,
        monto:    this.montoMensual,
        fecha:    fechaStr,
        metodo:   metodoStr,
        claveMes: this.clavesMes
      });

      this.pagadoEsteMes = true;
      this.toast.ok('¡Pago realizado correctamente!');
      await this.cargarDatos();
    } catch {
      this.toast.error('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      this.procesando = false;
    }
  }
}