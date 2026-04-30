import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth, signOut } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, collection, getDocs, query, where } from '@angular/fire/firestore';
import { loadStripe, Stripe, StripeCardElement } from '@stripe/stripe-js';
import { ToastService } from '../toast/toast.service';
import { NotificacionesService } from '../../services/notificaciones.service';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.css'
})
export class ConfiguracionComponent implements OnInit {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private toast     = inject(ToastService);
  private notifSvc  = inject(NotificacionesService);

  temaClaro            = false;
  tipoUsuario          = '';
  uid                  = '';
  domicilio: any       = null;
  metodoPago: any      = null;
  notificacionesActivas = false;
  togglingNotif        = false;

  // Modal cambio de rol
  modalRolVisible  = false;
  modalEstado: 'confirm' | 'stripe' | 'exito' = 'confirm';
  guardandoRol = false;

  // Stripe
  private stripe!: Stripe | null;
  private cardElement!: StripeCardElement;
  stripeError = '';

  ngOnInit() {
    const tema = localStorage.getItem('tema');
    this.temaClaro = tema === 'claro';

    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      this.uid = user.uid;
      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        this.tipoUsuario          = data['tipoUsuario']          || 'residente';
        this.domicilio            = data['domicilio']            || null;
        this.metodoPago           = data['metodoPago']           || null;
        this.notificacionesActivas = data['notificacionesActivas'] === true;
      }
    });
  }

  async toggleNotificaciones() {
    if (this.togglingNotif) return;
    this.togglingNotif = true;
    try {
      if (this.notificacionesActivas) {
        await this.notifSvc.desactivar(this.uid);
        this.notificacionesActivas = false;
        this.toast.info('Notificaciones desactivadas.');
      } else {
        const ok = await this.notifSvc.activar(this.uid);
        if (ok) {
          this.notificacionesActivas = true;
          this.toast.ok('Notificaciones activadas.');
        } else {
          this.toast.error('No se pudo activar. Revisa los permisos del navegador.');
        }
      }
    } catch {
      this.toast.error('Error al cambiar las notificaciones.');
    } finally {
      this.togglingNotif = false;
    }
  }

  toggleTema() {
    this.temaClaro = !this.temaClaro;
    if (this.temaClaro) {
      document.body.classList.add('tema-claro');
      localStorage.setItem('tema', 'claro');
    } else {
      document.body.classList.remove('tema-claro');
      localStorage.setItem('tema', 'oscuro');
    }
  }

  abrirModalRol() {
    this.modalRolVisible = true;
    this.modalEstado     = 'confirm';
    this.stripeError     = '';
  }

  cerrarModalRol() {
    this.modalRolVisible = false;
    if (this.stripe && this.cardElement) {
      this.cardElement.unmount();
    }
  }

  async confirmarCambioRol() {
    if (!this.domicilio?.calleNorm || !this.domicilio?.numeroNorm) {
      this.toast.error('Primero debes registrar tu domicilio en tu perfil.');
      this.cerrarModalRol();
      return;
    }

    this.guardandoRol = true;
    try {
      const snap = await getDocs(query(
        collection(this.firestore, 'usuarios'),
        where('domicilio.calleNorm', '==', this.domicilio.calleNorm),
        where('domicilio.numeroNorm', '==', this.domicilio.numeroNorm),
        where('tipoUsuario', '==', 'titular')
      ));
      const otros = snap.docs.filter(d => d.id !== this.uid);
      if (otros.length > 0) {
        this.toast.error('Ya existe un titular en esa dirección. No puedes ser titular aquí.');
        this.cerrarModalRol();
        return;
      }
    } catch {
      this.toast.error('Error al validar. Intenta de nuevo.');
      this.guardandoRol = false;
      return;
    } finally {
      this.guardandoRol = false;
    }

    if (!this.metodoPago) {
      this.modalEstado = 'stripe';
      setTimeout(() => this.iniciarStripe(), 300);
    } else {
      await this.guardarRolTitular();
    }
  }

  async iniciarStripe() {
    this.stripe = await loadStripe('pk_test_51T5VjJKadJSbpyI8FjOVDIxEiAO5IGu5RShBdZJbUDlaOjmWEalVreB0Ngf3RKdxr63xVrELIpZVeivkprVOFmrB00NTCKjq3m');
    if (!this.stripe) return;
    const elements = this.stripe.elements();
    this.cardElement = elements.create('card', {
      hidePostalCode: true,
      style: {
        base: { color: '#ffffff', fontFamily: 'Segoe UI, sans-serif', fontSize: '15px',
          '::placeholder': { color: '#aaaaaa' }, iconColor: '#FF6B00' },
        invalid: { color: '#ff4444' }
      }
    });
    this.cardElement.mount('#stripe-config');
    this.cardElement.on('change', e => { this.stripeError = e.error ? e.error.message : ''; });
  }

  async guardarTarjetaYRol() {
    if (!this.stripe || !this.cardElement) return;
    this.guardandoRol = true;
    this.stripeError  = '';
    try {
      const { paymentMethod, error } = await this.stripe.createPaymentMethod({ type: 'card', card: this.cardElement });
      if (error) { this.stripeError = error.message || 'Error al procesar la tarjeta.'; return; }
      this.metodoPago = {
        id: paymentMethod!.id, marca: paymentMethod!.card?.brand,
        ultimos4: paymentMethod!.card?.last4,
        expMes: paymentMethod!.card?.exp_month, expAnio: paymentMethod!.card?.exp_year
      };
      await setDoc(doc(this.firestore, 'usuarios', this.uid), { metodoPago: this.metodoPago }, { merge: true });
      await this.guardarRolTitular();
    } catch {
      this.stripeError = 'Error inesperado. Intenta de nuevo.';
    } finally {
      this.guardandoRol = false;
    }
  }

  async guardarRolTitular() {
    try {
      await setDoc(doc(this.firestore, 'usuarios', this.uid), { tipoUsuario: 'titular' }, { merge: true });
      this.tipoUsuario = 'titular';
      this.modalEstado = 'exito';
    } catch {
      this.toast.error('Error al cambiar el rol. Intenta de nuevo.');
      this.cerrarModalRol();
    }
  }

  async cerrarSesion() {
    const ok = await this.toast.confirmar('¿Cerrar sesión?');
    if (!ok) return;
    await signOut(this.auth);
    window.location.href = '/login';
  }
}