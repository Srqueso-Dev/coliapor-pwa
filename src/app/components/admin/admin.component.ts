import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';

import { Auth, signOut } from '@angular/fire/auth';
import { Firestore, collection, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, addDoc, query, orderBy } from '@angular/fire/firestore';

import * as L from 'leaflet';
import { ToastService } from '../toast/toast.service';
import { COLONIAS_TONALA } from '../onboarding/onboarding.component';

import emailjs from '@emailjs/browser';

function soloLetras(control: AbstractControl): ValidationErrors | null {
  const val = control.value || '';
  return /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]+$/.test(val) ? null : { soloLetras: true };
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit, OnDestroy {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private fb        = inject(FormBuilder);
  private toast     = inject(ToastService);

  seccionActiva = 'usuarios';
  colonias      = COLONIAS_TONALA;

  usuarios: any[]    = [];
  recolectores: any[] = [];
  fechas: any[]      = [];
  pagos: any[]       = [];
  solicitudes: any[] = [];
  camiones: any[]    = [];

  cargando = false;

  // ── EmailJS ───────────────────────────────────────────
  private emailjsServiceId  = 'service_k94jyol';
  private emailjsAprobadoId = 'template_dr4fkjj';
  private emailjsDenegadoId = 'template_gab6d54';
  private emailjsPublicKey  = 'A0deu2jst5GoehcRk';

  validarSoloLetras(event: KeyboardEvent) {
    const regex = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]+$/;
    if (event.key.length === 1 && !regex.test(event.key)) event.preventDefault();
  }

  // ── Forms ─────────────────────────────────────────────
  formRecolector: FormGroup = this.fb.group({
    nombre:   ['', [Validators.required, soloLetras]],
    telefono: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
    email:    ['', [Validators.required, Validators.email]],
    colonia:  ['', Validators.required]
  });

  formFecha: FormGroup = this.fb.group({
    fecha:       ['', Validators.required],
    hora:        ['', Validators.required],
    colonia:     ['', Validators.required],
    descripcion: ['']
  });

  formMonto: FormGroup = this.fb.group({
    monto: ['', [Validators.required, Validators.min(1)]]
  });

  formCamion: FormGroup = this.fb.group({
    placa:           ['', Validators.required],
    modelo:          ['', Validators.required],
    estado:          ['apagado', Validators.required],
    recolectorId:    [''],
    pesoActual:      [0, [Validators.required, Validators.min(0)]],
    contenedorLleno: [false, Validators.required]
  });

  editandoFecha:  any = null;
  editandoCamion: any = null;
  montoActual         = 0;

  // ── Modal aprobación ──────────────────────────────────
  modalSolicitud: any = null;
  aprobando           = false;

  // ── Mapa ──────────────────────────────────────────────
  private mapa!: L.Map;
  private capaMarcadores!: L.LayerGroup;
  mapaListo          = false;
  usuariosGeo: any[] = [];
  casaSeleccionada: any = null;

  // ── Getters ───────────────────────────────────────────
  get totalGanancias(): number { return this.pagos.reduce((acc, p) => acc + (p.monto || 0), 0); }
  get pagosMesActual(): any[]  { return this.pagos.filter(p => p.claveMes === this.clavesMes); }
  get clavesMes(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  get mesActualStr(): string {
    const now = new Date();
    const mes = now.toLocaleString('es-MX', { month: 'long' });
    return `${mes.charAt(0).toUpperCase() + mes.slice(1)} ${now.getFullYear()}`;
  }
  get solicitudesPendientes(): number {
    return this.solicitudes.filter(s => s.estado === 'pendiente').length;
  }
  get camionesEnServicio(): number {
    return this.camiones.filter(c => c.estado === 'servicio').length;
  }
  get camionesEnMantenimiento(): number {
    return this.camiones.filter(c => c.estado === 'mantenimiento').length;
  }
  get pesoTotalServicio(): number {
    return this.camiones
      .filter(c => c.estado === 'servicio')
      .reduce((acc, c) => acc + (c.pesoActual || 0), 0);
  }

  nombreRecolector(uid: string): string {
    const r = this.recolectores.find(r => r.uid === uid || r.id === uid);
    return r?.nombre || '—';
  }

  // ── Init ──────────────────────────────────────────────
  ngOnInit() {
    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      if (!snap.exists() || snap.data()['rol'] !== 'admin') {
        window.location.href = '/dashboard';
        return;
      }
      this.cargarDatos();
    });
  }

  ngOnDestroy() {
    if (this.mapa) this.mapa.remove();
  }

  async cargarDatos() {
    this.cargando = true;
    try {
      await Promise.all([
        this.cargarUsuarios(), this.cargarRecolectores(),
        this.cargarFechas(),   this.cargarPagos(),
        this.cargarMonto(),    this.cargarSolicitudes(),
        this.cargarCamiones()
      ]);
    } finally { this.cargando = false; }
  }

  async cargarUsuarios() {
    const snap = await getDocs(collection(this.firestore, 'usuarios'));
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    this.usuarios    = todos.filter((u: any) => u.rol !== 'admin' && u.rol !== 'recolector');
    this.usuariosGeo = todos.filter((u: any) => u.domicilio?.lat && u.domicilio?.lng);
  }

  async cargarRecolectores() {
    const snap = await getDocs(collection(this.firestore, 'recolectores'));
    this.recolectores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async cargarFechas() {
    const snap  = await getDocs(query(collection(this.firestore, 'fechasRecoleccion'), orderBy('fecha')));
    const hoy   = new Date().toISOString().split('T')[0];
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    for (const f of todas.filter((f: any) => f.fecha < hoy)) {
      await deleteDoc(doc(this.firestore, 'fechasRecoleccion', f.id));
    }
    this.fechas = todas.filter((f: any) => f.fecha >= hoy);
  }

  async cargarPagos() {
    const snap = await getDocs(query(collection(this.firestore, 'pagos'), orderBy('fecha', 'desc')));
    this.pagos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async cargarMonto() {
    const snap = await getDoc(doc(this.firestore, 'configuracion', 'pagos'));
    if (snap.exists()) {
      this.montoActual = snap.data()['montoMensual'] || 0;
      this.formMonto.patchValue({ monto: this.montoActual });
    }
  }

  async cargarSolicitudes() {
    const snap = await getDocs(query(collection(this.firestore, 'solicitudesRecolector'), orderBy('creadoEn', 'desc')));
    this.solicitudes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async cargarCamiones() {
    const snap = await getDocs(collection(this.firestore, 'camiones'));
    this.camiones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── Sección ───────────────────────────────────────────
  setSeccion(s: string) {
    this.seccionActiva = s;
    if (s === 'mapa') setTimeout(() => this.iniciarMapa(), 300);
  }

  // ── Mapa ──────────────────────────────────────────────
  iniciarMapa() {
    if (this.mapa) { this.mapa.invalidateSize(); return; }
    this.mapa = L.map('mapa-admin', { zoomControl: true }).setView([20.6534, -103.2340], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 21
    }).addTo(this.mapa);
    this.capaMarcadores = L.layerGroup().addTo(this.mapa);
    this.mapaListo = true;
    this.pintarPins();
  }

  pagoClave(usuario: any): boolean {
    return !!(usuario.pagos && usuario.pagos[this.clavesMes]);
  }

  pintarPins() {
    if (!this.mapa || !this.capaMarcadores) return;
    this.capaMarcadores.clearLayers();
    this.usuariosGeo.forEach(u => {
      const pagado = this.pagoClave(u);
      const color  = pagado ? '#00E676' : '#FF6B00';
      const borde  = pagado ? '#00a152' : '#c44000';
      const numero = u.domicilio?.numero || '?';
      const icono  = L.divIcon({
        className: '',
        html: `<div class="pin-casa" style="background:${color};border-color:${borde};">
                 <span>${numero}</span>
                 <div class="pin-punta" style="border-top-color:${color};"></div>
               </div>`,
        iconSize: [38, 44], iconAnchor: [19, 44], popupAnchor: [0, -44]
      });
      const marker = L.marker([u.domicilio.lat, u.domicilio.lng], { icon: icono });
      marker.on('click', () => { this.casaSeleccionada = { ...u, pagado }; });
      this.capaMarcadores.addLayer(marker);
    });
  }

  cerrarDetalle() { this.casaSeleccionada = null; }

  // ── Usuarios ──────────────────────────────────────────
  async darDeBaja(uid: string) {
    const ok = await this.toast.confirmar('¿Dar de baja a este usuario?');
    if (!ok) return;
    try {
      await updateDoc(doc(this.firestore, 'usuarios', uid), { activo: false });
      this.toast.ok('Usuario dado de baja correctamente.');
      await this.cargarUsuarios();
    } catch { this.toast.error('Error al dar de baja al usuario.'); }
  }

  async reactivar(uid: string) {
    try {
      await updateDoc(doc(this.firestore, 'usuarios', uid), { activo: true });
      this.toast.ok('Usuario reactivado correctamente.');
      await this.cargarUsuarios();
    } catch { this.toast.error('Error al reactivar usuario.'); }
  }

  async resetOnboarding(uid: string) {
    const ok = await this.toast.confirmar('¿Resetear el onboarding? El usuario lo verá en su próximo login.');
    if (!ok) return;
    try {
      await updateDoc(doc(this.firestore, 'usuarios', uid), { perfilCompleto: false });
      this.toast.ok('Onboarding reseteado.');
      await this.cargarUsuarios();
    } catch { this.toast.error('Error al resetear el onboarding.'); }
  }

  // ── Solicitudes ───────────────────────────────────────
  abrirModalAprobar(solicitud: any) { this.modalSolicitud = solicitud; }
  cerrarModal() { this.modalSolicitud = null; }

  async aprobarSolicitud() {
    this.aprobando = true;
    const s = this.modalSolicitud;

    try {
      const coloniaFinal = s.zona || s.colonia || '';

      // 1. Crear documento en 'recolectores' para que aparezca en el panel
      //    inmediatamente, antes de que el recolector haga su primer login
      await addDoc(collection(this.firestore, 'recolectores'), {
        nombre:      s.nombre,
        email:       s.email,
        telefono:    s.telefono || '',
        colonia:     coloniaFinal,
        activo:      true,
        creadoEn:    new Date(),
        solicitudId: s.id
      });

      // 2. Marcar solicitud como aprobada
      await updateDoc(doc(this.firestore, 'solicitudesRecolector', s.id), {
        estado:     'aprobada',
        aprobadoEn: new Date()
      });

      // 3. Correo personalizado de bienvenida vía EmailJS
      //    Firebase Auth mandará su propio correo de verificación por separado
      await emailjs.send(
        this.emailjsServiceId,
        this.emailjsAprobadoId,
        {
          nombre: s.nombre,
          zona:   coloniaFinal,
          email:  s.email
        },
        this.emailjsPublicKey
      );

      this.toast.ok(`Aprobado. Correo de bienvenida enviado a ${s.email}.`);
      this.cerrarModal();
      await Promise.all([this.cargarSolicitudes(), this.cargarRecolectores()]);

    } catch (error: any) {
      console.error('Error al aprobar solicitud:', error);
      this.toast.error('Error al aprobar la solicitud. Revisa la consola.');
    } finally {
      this.aprobando = false;
    }
  }

  async declinarSolicitud(id: string) {
    const s = this.solicitudes.find(sol => sol.id === id);
    if (!s) return;

    const ok = await this.toast.confirmar(`¿Declinar la solicitud de ${s.nombre}?`);
    if (!ok) return;

    try {
      // Conservar historial marcando como declinada
      await updateDoc(doc(this.firestore, 'solicitudesRecolector', id), {
        estado:      'declinada',
        declinadoEn: new Date()
      });

      const coloniaFinal = s.zona || s.colonia || '';
      await emailjs.send(
        this.emailjsServiceId,
        this.emailjsDenegadoId,
        { nombre: s.nombre, zona: coloniaFinal, email: s.email },
        this.emailjsPublicKey
      );

      this.toast.ok('Solicitud declinada y correo enviado.');
      await this.cargarSolicitudes();
    } catch (error) {
      this.toast.error('Error al declinar la solicitud.');
      console.error(error);
    }
  }

  // ── Recolectores ──────────────────────────────────────
  async agregarRecolector() {
    if (this.formRecolector.invalid) { this.formRecolector.markAllAsTouched(); return; }
    this.cargando = true;
    try {
      await addDoc(collection(this.firestore, 'recolectores'), {
        ...this.formRecolector.value, activo: true, creadoEn: new Date()
      });
      this.formRecolector.reset();
      this.toast.ok('Recolector agregado correctamente.');
      await this.cargarRecolectores();
    } catch { this.toast.error('Error al agregar recolector.');
    } finally { this.cargando = false; }
  }

  async eliminarRecolector(id: string) {
    const ok = await this.toast.confirmar('¿Eliminar este recolector?');
    if (!ok) return;
    try {
      await deleteDoc(doc(this.firestore, 'recolectores', id));
      this.toast.ok('Recolector eliminado.');
      await this.cargarRecolectores();
    } catch { this.toast.error('Error al eliminar recolector.'); }
  }

  // ── Fechas ────────────────────────────────────────────
  async guardarFecha() {
    if (this.formFecha.invalid) { this.formFecha.markAllAsTouched(); return; }
    this.cargando = true;
    try {
      if (this.editandoFecha) {
        await updateDoc(doc(this.firestore, 'fechasRecoleccion', this.editandoFecha.id), { ...this.formFecha.value });
        this.toast.ok('Fecha actualizada correctamente.');
        this.editandoFecha = null;
      } else {
        await addDoc(collection(this.firestore, 'fechasRecoleccion'), { ...this.formFecha.value, creadoEn: new Date() });
        this.toast.ok('Fecha agregada correctamente.');
      }
      this.formFecha.reset();
      await this.cargarFechas();
    } catch { this.toast.error('Error al guardar la fecha.');
    } finally { this.cargando = false; }
  }

  editarFecha(fecha: any) {
    this.editandoFecha = fecha;
    this.formFecha.patchValue({
      fecha: fecha.fecha, hora: fecha.hora,
      colonia: fecha.colonia, descripcion: fecha.descripcion || ''
    });
    this.seccionActiva = 'fechas';
  }

  cancelarEdicionFecha() { this.editandoFecha = null; this.formFecha.reset(); }

  async eliminarFecha(id: string) {
    const ok = await this.toast.confirmar('¿Eliminar esta fecha de recolección?');
    if (!ok) return;
    try {
      await deleteDoc(doc(this.firestore, 'fechasRecoleccion', id));
      this.toast.ok('Fecha eliminada.');
      await this.cargarFechas();
    } catch { this.toast.error('Error al eliminar la fecha.'); }
  }

  // ── Camiones ──────────────────────────────────────────
  async guardarCamion() {
    if (this.formCamion.invalid) { this.formCamion.markAllAsTouched(); return; }
    this.cargando = true;
    const datos = {
      placa:               this.formCamion.value.placa.toUpperCase().trim(),
      modelo:              this.formCamion.value.modelo.trim(),
      estado:              this.formCamion.value.estado,
      recolectorId:        this.formCamion.value.recolectorId || '',
      pesoActual:          Number(this.formCamion.value.pesoActual),
      contenedorLleno:     this.formCamion.value.contenedorLleno === true ||
                           this.formCamion.value.contenedorLleno === 'true',
      ultimaActualizacion: new Date()
    };
    try {
      if (this.editandoCamion) {
        await updateDoc(doc(this.firestore, 'camiones', this.editandoCamion.id), datos);
        this.toast.ok('Camión actualizado correctamente.');
        this.editandoCamion = null;
      } else {
        await addDoc(collection(this.firestore, 'camiones'), { ...datos, creadoEn: new Date() });
        this.toast.ok('Camión agregado correctamente.');
      }
      this.formCamion.reset({ estado: 'apagado', pesoActual: 0, contenedorLleno: false });
      await this.cargarCamiones();
    } catch { this.toast.error('Error al guardar el camión.');
    } finally { this.cargando = false; }
  }

  editarCamion(camion: any) {
    this.editandoCamion = camion;
    this.formCamion.patchValue({
      placa:           camion.placa,
      modelo:          camion.modelo,
      estado:          camion.estado,
      recolectorId:    camion.recolectorId || '',
      pesoActual:      camion.pesoActual || 0,
      contenedorLleno: camion.contenedorLleno || false
    });
    this.seccionActiva = 'camiones';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelarEdicionCamion() {
    this.editandoCamion = null;
    this.formCamion.reset({ estado: 'apagado', pesoActual: 0, contenedorLleno: false });
  }

  async eliminarCamion(id: string) {
    const ok = await this.toast.confirmar('¿Eliminar este camión? Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      await deleteDoc(doc(this.firestore, 'camiones', id));
      this.toast.ok('Camión eliminado.');
      await this.cargarCamiones();
    } catch { this.toast.error('Error al eliminar el camión.'); }
  }

  estadoLabel(estado: string): string {
    const map: any = { servicio: 'En servicio', mantenimiento: 'En mantenimiento', apagado: 'Apagado' };
    return map[estado] || estado;
  }

  estadoColor(estado: string): string {
    if (estado === 'servicio')      return '#00E676';
    if (estado === 'mantenimiento') return '#FF6B00';
    return '#aaaaaa';
  }

  // ── Monto ─────────────────────────────────────────────
  async guardarMonto() {
    if (this.formMonto.invalid) { this.formMonto.markAllAsTouched(); return; }
    this.cargando = true;
    try {
      await setDoc(doc(this.firestore, 'configuracion', 'pagos'), { montoMensual: Number(this.formMonto.value.monto) });
      this.montoActual = Number(this.formMonto.value.monto);
      this.toast.ok('Monto actualizado correctamente.');
    } catch { this.toast.error('Error al guardar el monto.');
    } finally { this.cargando = false; }
  }

  // ── Utils ─────────────────────────────────────────────
  async cerrarSesion() { await signOut(this.auth); window.location.href = '/login'; }
}