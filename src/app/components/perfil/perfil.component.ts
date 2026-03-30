import { Component, inject, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, collection, getDocs, query, where } from '@angular/fire/firestore';
import { loadStripe, Stripe, StripeCardElement } from '@stripe/stripe-js';
import * as L from 'leaflet';
import { COLONIAS_TONALA } from '../onboarding/onboarding.component';
import { ToastService } from '../toast/toast.service';

const CACHE_KEY = 'coliapor_perfil';

function soloLetras(control: AbstractControl): ValidationErrors | null {
  const val = control.value || '';
  return /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]+$/.test(val) ? null : { soloLetras: true };
}

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterModule],
  templateUrl: './perfil.component.html',
  styleUrl: './perfil.component.css'
})
export class PerfilComponent implements OnInit {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private fb        = inject(FormBuilder);
  private toast     = inject(ToastService);

  formPersonal: FormGroup = this.fb.group({
    nombre:   ['', [Validators.required, Validators.minLength(3), soloLetras]],
    telefono: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]]
  });

  formDomicilio: FormGroup = this.fb.group({
    calle:   ['', Validators.required],
    numero:  ['', Validators.required],
    colonia: ['', Validators.required]
  });

  email             = '';
  tipoUsuario       = 'titular';
  metodoPago: any   = null;
  guardando         = false;
  guardadoOk        = false;
  editandoPersonal  = false;
  editandoDomicilio = false;
  editandoPago      = false;
  offline           = false;
  pendienteSync     = false;
  errorDomicilio    = '';

  latitud  = 20.6534;
  longitud = -103.2340;

  private mapaPerfil!: L.Map;
  private pinPerfil!: L.Marker;

  colonias        = COLONIAS_TONALA;
  coloniaFiltrada = '';

  private stripe!: Stripe | null;
  private cardElement!: StripeCardElement;
  stripeError   = '';
  guardandoPago = false;

  get coloniasFiltradas(): string[] {
    if (!this.coloniaFiltrada) return this.colonias;
    return this.colonias.filter(c =>
      c.toLowerCase().includes(this.coloniaFiltrada.toLowerCase())
    );
  }

  ngOnInit() {
    this.offline = !navigator.onLine;
    window.addEventListener('online',  () => { this.offline = false; this.sincronizar(); });
    window.addEventListener('offline', () => { this.offline = true; });

    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      this.email = user.email || '';
      this.cargarDesdeCache();
      if (navigator.onLine) {
        try {
          const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
          if (snap.exists()) {
            const data = snap.data();
            this.aplicarDatos(data);
            this.guardarEnCache(data);
          }
        } catch { }
      }
    });
  }

  aplicarDatos(data: any) {
    this.tipoUsuario = data['tipoUsuario'] || 'titular';
    this.formPersonal.patchValue({ nombre: data['nombre'] || '', telefono: data['telefono'] || '' });
    if (data['domicilio']) {
      this.formDomicilio.patchValue({
        calle: data['domicilio'].calle || '', numero: data['domicilio'].numero || '', colonia: data['domicilio'].colonia || ''
      });
      this.coloniaFiltrada = data['domicilio'].colonia || '';
      this.latitud         = data['domicilio'].lat     || 20.6534;
      this.longitud        = data['domicilio'].lng     || -103.2340;
    }
    this.metodoPago = data['metodoPago'] || null;
  }

  guardarEnCache(data: any) {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      nombre: data['nombre'] || '', telefono: data['telefono'] || '',
      tipoUsuario: data['tipoUsuario'] || 'titular',
      domicilio: data['domicilio'] || {}, metodoPago: data['metodoPago'] || null
    }));
  }

  cargarDesdeCache() {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    try { this.aplicarDatos(JSON.parse(raw)); } catch { }
  }

  async sincronizar() {
    const pendiente = localStorage.getItem(CACHE_KEY + '_pendiente');
    if (!pendiente) return;
    const user = this.auth.currentUser;
    if (!user) return;
    try {
      await setDoc(doc(this.firestore, 'usuarios', user.uid), JSON.parse(pendiente), { merge: true });
      localStorage.removeItem(CACHE_KEY + '_pendiente');
      this.pendienteSync = false;
    } catch { }
  }

  seleccionarColonia(colonia: string) {
    this.formDomicilio.patchValue({ colonia });
    this.coloniaFiltrada = colonia;
  }

  toggleEditarPersonal() { this.editandoPersonal = !this.editandoPersonal; this.guardadoOk = false; }

  toggleEditarDomicilio() {
    this.editandoDomicilio = !this.editandoDomicilio;
    this.errorDomicilio    = '';
    this.guardadoOk        = false;
    if (this.editandoDomicilio) {
      this.coloniaFiltrada = this.formDomicilio.value.colonia || '';
      setTimeout(() => this.iniciarMapaPerfil(), 400);
    } else {
      if (this.mapaPerfil) { this.mapaPerfil.remove(); (this.mapaPerfil as any) = null; }
    }
  }

  crearIconoPin(numero: string): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<div class="pin-casa" style="background:#FF6B00;border-color:#c44000;">
               <span>${numero}</span>
               <div class="pin-punta" style="border-top-color:#FF6B00;"></div>
             </div>`,
      iconSize: [38, 44], iconAnchor: [19, 44]
    });
  }

  iniciarMapaPerfil() {
    if (this.mapaPerfil) { this.mapaPerfil.invalidateSize(); return; }
    this.mapaPerfil = L.map('mapa-perfil').setView([this.latitud, this.longitud], 19);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 21
    }).addTo(this.mapaPerfil);

    const numero = this.formDomicilio.value.numero || '?';
    this.pinPerfil = L.marker([this.latitud, this.longitud], {
      draggable: true, icon: this.crearIconoPin(numero)
    }).addTo(this.mapaPerfil);

    this.pinPerfil.on('dragend', () => {
      const pos = this.pinPerfil.getLatLng();
      this.latitud = pos.lat; this.longitud = pos.lng;
    });
  }

  async toggleEditarPago() {
    this.editandoPago = !this.editandoPago;
    this.stripeError  = '';
    if (this.editandoPago) await this.iniciarStripe();
  }

  async iniciarStripe() {
    setTimeout(async () => {
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
      this.cardElement.mount('#stripe-card-perfil');
      this.cardElement.on('change', e => { this.stripeError = e.error ? e.error.message : ''; });
    }, 300);
  }

  async guardarNuevaTarjeta() {
    if (!this.stripe || !this.cardElement) return;
    this.guardandoPago = true; this.stripeError = '';
    try {
      const { paymentMethod, error } = await this.stripe.createPaymentMethod({ type: 'card', card: this.cardElement });
      if (error) { this.stripeError = error.message || 'Error al procesar la tarjeta.'; return; }
      const user = this.auth.currentUser;
      if (!user) return;
      const metodo = {
        id: paymentMethod!.id, marca: paymentMethod!.card?.brand,
        ultimos4: paymentMethod!.card?.last4,
        expMes: paymentMethod!.card?.exp_month, expAnio: paymentMethod!.card?.exp_year
      };
      await setDoc(doc(this.firestore, 'usuarios', user.uid), { metodoPago: metodo }, { merge: true });
      this.metodoPago   = metodo;
      this.editandoPago = false;
      this.guardadoOk   = true;
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) { const c = JSON.parse(raw); c.metodoPago = metodo; localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }
      this.toast.ok('Tarjeta guardada correctamente.');
      setTimeout(() => this.guardadoOk = false, 3000);
    } catch { this.stripeError = 'Error inesperado. Intenta de nuevo.'; }
    finally { this.guardandoPago = false; }
  }

  async guardarPersonal() {
    if (this.formPersonal.invalid) { this.formPersonal.markAllAsTouched(); return; }
    this.guardando = true;
    const user = this.auth.currentUser;
    if (!user) return;
    const cambios = { nombre: this.formPersonal.value.nombre.trim(), telefono: this.formPersonal.value.telefono };
    try {
      if (navigator.onLine) {
        await setDoc(doc(this.firestore, 'usuarios', user.uid), cambios, { merge: true });
      } else {
        localStorage.setItem(CACHE_KEY + '_pendiente', JSON.stringify(cambios));
        this.pendienteSync = true;
      }
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) { const c = JSON.parse(raw); Object.assign(c, cambios); localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }
      this.guardadoOk = true;
      this.editandoPersonal = false;
      this.toast.ok('Datos personales actualizados.');
      setTimeout(() => this.guardadoOk = false, 3000);
    } catch { this.toast.error('Error al guardar. Intenta de nuevo.'); }
    finally { this.guardando = false; }
  }

  async guardarDomicilio() {
    if (this.formDomicilio.invalid) { this.formDomicilio.markAllAsTouched(); return; }
    this.errorDomicilio = '';

    if (this.tipoUsuario === 'titular') {
      const user = this.auth.currentUser;
      if (!user) return;
      const calle  = this.formDomicilio.value.calle.trim().toLowerCase();
      const numero = this.formDomicilio.value.numero.trim().toLowerCase();
      try {
        const snap = await getDocs(query(
          collection(this.firestore, 'usuarios'),
          where('domicilio.calleNorm', '==', calle),
          where('domicilio.numeroNorm', '==', numero),
          where('tipoUsuario', '==', 'titular')
        ));
        if (snap.docs.filter(d => d.id !== user.uid).length > 0) {
          this.errorDomicilio = 'Ya existe un titular en esa dirección.';
          return;
        }
      } catch { }
    }

    this.guardando = true;
    const user = this.auth.currentUser;
    if (!user) return;
    const domicilio = {
      calle:      this.formDomicilio.value.calle,
      numero:     this.formDomicilio.value.numero,
      colonia:    this.formDomicilio.value.colonia,
      calleNorm:  this.formDomicilio.value.calle.trim().toLowerCase(),
      numeroNorm: this.formDomicilio.value.numero.trim().toLowerCase(),
      lat:        this.latitud,
      lng:        this.longitud
    };
    try {
      if (navigator.onLine) {
        await setDoc(doc(this.firestore, 'usuarios', user.uid), { domicilio }, { merge: true });
      } else {
        localStorage.setItem(CACHE_KEY + '_pendiente', JSON.stringify({ domicilio }));
        this.pendienteSync = true;
      }
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) { const c = JSON.parse(raw); c.domicilio = domicilio; localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }
      this.guardadoOk       = true;
      this.editandoDomicilio = false;
      if (this.mapaPerfil) { this.mapaPerfil.remove(); (this.mapaPerfil as any) = null; }
      this.toast.ok('Domicilio actualizado correctamente.');
      setTimeout(() => this.guardadoOk = false, 3000);
    } catch { this.toast.error('Error al guardar. Intenta de nuevo.'); }
    finally { this.guardando = false; }
  }
}