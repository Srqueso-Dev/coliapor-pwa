import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatStepperModule } from '@angular/material/stepper';
import { StepperSelectionEvent } from '@angular/cdk/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, setDoc, collection, getDocs, query, where } from '@angular/fire/firestore';
import * as L from 'leaflet';
import { loadStripe, Stripe, StripeCardElement } from '@stripe/stripe-js';
import { ToastService } from '../toast/toast.service';

// ── Polígono de Tonalá ──────────────────────────────────
const POLIGONO_TONALA = [
  [-103.2783061332037,20.64316866322505],[-103.278943312135,20.64271410496616],
  [-103.2795045385439,20.64217604173941],[-103.2799861445937,20.64158399893406],
  [-103.280460677302,20.64091168754044],[-103.2806857442064,20.640558241467],
  [-103.2808470888195,20.640360478538],[-103.2809365822731,20.64018251094772],
  [-103.2809868402913,20.64002662829048],[-103.2810559170416,20.63978476914736],
  [-103.2810724954601,20.63954270867479],[-103.2810886170442,20.63941460200584],
  [-103.2811180634174,20.63920646886609],[-103.2811358759326,20.63913288257235],
  [-103.2811921851664,20.63898881648985],[-103.2812867298601,20.6388227506356],
  [-103.2813857634278,20.63870102239944],[-103.2814898059552,20.63859034776318],
  [-103.2816431662098,20.63843158125072],[-103.281811226774,20.63826585375307],
  [-103.2820285968213,20.63804661518741],[-103.2821991434144,20.63787971812973],
  [-103.2824421045547,20.63762996459876],[-103.2825687250927,20.63748653150969],
  [-103.2827861986134,20.63720980847224],[-103.283051939798,20.63687231324216],
  [-103.2838452960662,20.63585122842413],[-103.2842238526376,20.6348846171674],
  [-103.2851669601937,20.63175169652732],[-103.2854121683936,20.63026236104177],
  [-103.2853862752916,20.62928775116004],[-103.285359178137,20.6286407286308],
  [-103.2855407251901,20.62818724607714],[-103.2860271783163,20.62751414400626],
  [-103.2863691782774,20.62704481702445],[-103.2866619343824,20.626372075395],
  [-103.2867474110838,20.62603156724046],[-103.2789758108095,20.62304541452951],
  [-103.2729915359436,20.62054304869341],[-103.2693055802832,20.61896034103501],
  [-103.264378904871,20.61833704325199],[-103.2544646386517,20.61686273239086],
  [-103.2470655944531,20.61598785428156],[-103.2423006215232,20.61565433697816],
  [-103.2407934008189,20.61550588561493],[-103.2347356336216,20.61641224744408],
  [-103.2260168175937,20.61765674457545],[-103.2243934204946,20.6179473756968],
  [-103.2241884894856,20.61837604159784],[-103.2236648347213,20.61880251855951],
  [-103.2228997833787,20.6196741291105],[-103.2226947817184,20.62006952474972],
  [-103.2222632502588,20.62104402405341],[-103.2217993716883,20.62163091065061],
  [-103.2213751879523,20.62216205024792],[-103.2197787620997,20.62323550091768],
  [-103.2185896446778,20.62367785543623],[-103.2179906010542,20.62380465238376],
  [-103.2144535999838,20.62375740807187],[-103.2128391227799,20.62380528145754],
  [-103.2119073509368,20.62493907512433],[-103.2111781039377,20.62762623789246],
  [-103.2110958177619,20.62985013286658],[-103.2109788420428,20.63184004640949],
  [-103.2104784951607,20.63356685405211],[-103.2097114310487,20.63535584894076],
  [-103.2084047209775,20.63757859250067],[-103.2076269866604,20.63913130567813],
  [-103.2060579646512,20.64206037636778],[-103.2053190285253,20.64333119143044],
  [-103.2045340484408,20.64494500908469],[-103.2042444553901,20.64640385099529],
  [-103.2043298777735,20.64835766939463],[-103.2049712788008,20.65014665344512],
  [-103.2061671632395,20.65189650303115],[-103.2075434033771,20.65307730444556],
  [-103.2092299619724,20.65422492039016],[-103.2116657900433,20.65581388228355],
  [-103.2128617393377,20.65659795171955],[-103.2141516856186,20.65796023951697],
  [-103.2154546672082,20.65955358923101],[-103.216238439678,20.66037275378411],
  [-103.2176133589834,20.66191562530176],[-103.2191440996706,20.66382528100743],
  [-103.2199954821913,20.66478927830378],[-103.2226495993274,20.66767342829618],
  [-103.2245062868511,20.66981418102769],[-103.2250105159279,20.67029581638422],
  [-103.2267212782859,20.6700057055352],[-103.2308502011503,20.66938933226819],
  [-103.2349511015487,20.66886431532535],[-103.2362401027757,20.66861203817518],
  [-103.237545383077,20.66780100995935],[-103.2389535200596,20.66705504889433],
  [-103.2411137095958,20.66615816678136],[-103.2420571443136,20.66578217864462],
  [-103.2466745051468,20.66591055338249],[-103.2523992676345,20.66624177459943],
  [-103.2552222661518,20.66663774182284],[-103.2605894975175,20.66670058682187],
  [-103.2606220091769,20.66795608142042],[-103.2605311645204,20.67016258783165],
  [-103.2622633681029,20.67034712276364],[-103.2641628075136,20.67047470743193],
  [-103.2641694954308,20.66995231307745],[-103.263875868762,20.66909348169725],
  [-103.2637439251624,20.66869921101848],[-103.2639893230555,20.66778744663431],
  [-103.2648517065781,20.66719885769498],[-103.2657084497222,20.66696458089956],
  [-103.2668971779081,20.66540980017792],[-103.2675908752576,20.66431172891267],
  [-103.2677831460806,20.66354464502117],[-103.2678252730654,20.66189150623016],
  [-103.2681623325849,20.66017547442403],[-103.2680646138819,20.65940620200877],
  [-103.2676294166345,20.65809334367183],[-103.2675498145496,20.65676645533734],
  [-103.2674707300498,20.65562371314603],[-103.2674657740081,20.65518873937824],
  [-103.2675855310142,20.65485435437312],[-103.268589398957,20.65379333971161],
  [-103.2690560259895,20.6532341194853],[-103.2692850330529,20.65245534547129],
  [-103.2697841271807,20.64995505936801],[-103.2699972612503,20.64915498614712],
  [-103.2704990505045,20.64877337355367],[-103.2711608540116,20.64841591723582],
  [-103.2715567133366,20.64807118835693],[-103.2717974773075,20.64736858368382],
  [-103.2722014800393,20.646729616513],[-103.2727984572601,20.64592247463511],
  [-103.2734166196106,20.6452632116293],[-103.2742053257939,20.64496088838007],
  [-103.2746075643851,20.64473024927638],[-103.2750197967244,20.64431134285044],
  [-103.2755366129659,20.64399711091546],[-103.2766479237027,20.64381007718588],
  [-103.2775861389615,20.64362688610345],[-103.2783061332037,20.64316866322505]
];

export const COLONIAS_TONALA = [
  'Altamira', 'Basilio Badillo', 'Coyula', 'Educadores Jaliscienses',
  'El Moral', 'El Rosario', 'Francisco Villa', 'Jardines de la Cruz',
  'La Hortaliza', 'Las Huertas', 'Loma Dorada', 'Lomas de la Soledad',
  'Lomas del Camichín', 'Los Manguitos', 'Los Pinos', 'Misión de la Cantera',
  'Paseo del Valle', 'Tonalá Centro', 'Zalatitán'
];

// Validator: solo letras (incluyendo acentos) y espacios
function soloLetras(control: AbstractControl): ValidationErrors | null {
  const val = control.value || '';
  return /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]+$/.test(val) ? null : { soloLetras: true };
}

function puntoEnPoligono(lat: number, lng: number, poligono: number[][]): boolean {
  let dentro = false;
  const x = lng, y = lat;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const xi = poligono[i][0], yi = poligono[i][1];
    const xj = poligono[j][0], yj = poligono[j][1];
    const intersecta = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersecta) dentro = !dentro;
  }
  return dentro;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatStepperModule,
    MatFormFieldModule, MatInputModule, MatButtonModule,
    MatNativeDateModule, MatIconModule, FormsModule
  ],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css'
})
export class OnboardingComponent implements OnInit, OnDestroy {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private fb        = inject(FormBuilder);
  private toast     = inject(ToastService);

  tipoUsuario: 'titular' | 'residente' | '' = '';
  errorTipo = '';

  paso1: FormGroup = this.fb.group({
    nombre: ['', [
      Validators.required,
      Validators.minLength(3),
      soloLetras
    ]],
    telefono:        ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
    fechaNacimiento: ['', Validators.required]
  });

  paso2: FormGroup = this.fb.group({
    calle:   ['', Validators.required],
    numero:  ['', Validators.required],
    colonia: ['', Validators.required]
  });

  colonias        = COLONIAS_TONALA;
  coloniaFiltrada = '';

  private mapa!: L.Map;
  private pinCasa!: L.Marker;
  latitud           = 20.6534;
  longitud          = -103.2340;
  buscandoDireccion = false;
  errorUbicacion    = '';
  errorDireccion    = '';

  private stripe!: Stripe | null;
  private cardElement!: StripeCardElement;
  stripeError  = '';
  guardando    = false;
  pagoGuardado = false;
  errorEdad    = '';

  get fechaMaxima(): string {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().split('T')[0];
  }

  get coloniasFiltradas(): string[] {
    if (!this.coloniaFiltrada) return this.colonias;
    return this.colonias.filter(c =>
      c.toLowerCase().includes(this.coloniaFiltrada.toLowerCase())
    );
  }

  ngOnInit() {
    this.auth.onAuthStateChanged(user => {
      if (!user) window.location.href = '/login';
    });
  }

  ngOnDestroy() {
    if (this.mapa) this.mapa.remove();
  }

  seleccionarTipo(tipo: 'titular' | 'residente') {
    this.tipoUsuario = tipo;
    this.errorTipo   = '';
  }

  seleccionarColonia(colonia: string) {
    this.paso2.patchValue({ colonia });
    this.coloniaFiltrada = colonia;
  }

  onStepChange(event: StepperSelectionEvent) {
    if (event.selectedIndex === 1) setTimeout(() => this.iniciarMapa(), 300);
    if (event.selectedIndex === 2 && this.tipoUsuario === 'titular') setTimeout(() => this.iniciarStripe(), 300);
  }

  crearIconoPin(numero: string): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<div class="pin-casa" style="background:#FF6B00;border-color:#c44000;">
               <span>${numero}</span>
               <div class="pin-punta" style="border-top-color:#FF6B00;"></div>
             </div>`,
      iconSize:   [38, 44],
      iconAnchor: [19, 44]
    });
  }

  iniciarMapa() {
    if (this.mapa) { this.mapa.invalidateSize(); return; }
    this.mapa = L.map('mapa-onboarding').setView([this.latitud, this.longitud], 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 21
    }).addTo(this.mapa);

    const numero = this.paso2.value.numero || '?';
    this.pinCasa = L.marker([this.latitud, this.longitud], {
      draggable: true,
      icon: this.crearIconoPin(numero)
    }).addTo(this.mapa);

    this.pinCasa.on('dragend', () => {
      const pos = this.pinCasa.getLatLng();
      this.actualizarCoordenadas(pos.lat, pos.lng);
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        this.latitud  = pos.coords.latitude;
        this.longitud = pos.coords.longitude;
        this.mapa.setView([this.latitud, this.longitud], 19);
        this.pinCasa.setLatLng([this.latitud, this.longitud]);
        this.actualizarCoordenadas(this.latitud, this.longitud);
      }, () => {});
    }
  }

  actualizarCoordenadas(lat: number, lng: number) {
    this.latitud  = lat;
    this.longitud = lng;
    if (!puntoEnPoligono(lat, lng, POLIGONO_TONALA)) {
      this.errorUbicacion = 'La ubicación está fuera de Tonalá. Solo se aceptan domicilios dentro del municipio.';
    } else {
      this.errorUbicacion = '';
      this.obtenerDireccion(lat, lng);
    }
  }

  async obtenerDireccion(lat: number, lng: number) {
    this.buscandoDireccion = true;
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
      const addr = (await res.json()).address;
      const coloniaDetectada = addr.suburb || addr.neighbourhood || addr.quarter || '';
      const coloniaEnLista   = this.colonias.find(c => c.toLowerCase() === coloniaDetectada.toLowerCase());
      if (coloniaEnLista) {
        this.paso2.patchValue({ colonia: coloniaEnLista });
        this.coloniaFiltrada = coloniaEnLista;
      }
    } catch { } finally { this.buscandoDireccion = false; }
  }

  esMayorDeEdad(fecha: string): boolean {
    const hoy        = new Date();
    const nacimiento = new Date(fecha);
    const edad       = hoy.getFullYear() - nacimiento.getFullYear();
    const m          = hoy.getMonth() - nacimiento.getMonth();
    return edad > 18 || (edad === 18 && (m > 0 || (m === 0 && hoy.getDate() >= nacimiento.getDate())));
  }

  async guardarPaso1() {
    if (!this.tipoUsuario) { this.errorTipo = 'Selecciona un tipo de usuario.'; return; }
    if (this.paso1.invalid) { this.paso1.markAllAsTouched(); return; }
    if (!this.esMayorDeEdad(this.paso1.value.fechaNacimiento)) {
      this.errorEdad = 'Debes ser mayor de 18 años para usar Coliapor.';
      return;
    }
    this.errorEdad = '';
    this.guardando = true;
    const user = this.auth.currentUser;
    if (!user) return;
    try {
      await setDoc(doc(this.firestore, 'usuarios', user.uid), {
        nombre:          this.paso1.value.nombre.trim(),
        telefono:        this.paso1.value.telefono,
        fechaNacimiento: this.paso1.value.fechaNacimiento,
        email:           user.email,
        tipoUsuario:     this.tipoUsuario,
        perfilCompleto:  false,
        activo:          true,
        creadoEn:        new Date()
      }, { merge: true });
    } catch {
      this.toast.error('Error al guardar. Intenta de nuevo.');
    } finally { this.guardando = false; }
  }
  validarSoloLetras(event: KeyboardEvent) {
    const regex = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]+$/;
    if (event.key.length === 1 && !regex.test(event.key)) {
      event.preventDefault();
    }
  }

  async guardarPaso2() {
    if (this.paso2.invalid) { this.paso2.markAllAsTouched(); return; }
    if (this.errorUbicacion) return;

    if (this.tipoUsuario === 'titular') {
      this.guardando = true;
      try {
        const calle  = this.paso2.value.calle.trim().toLowerCase();
        const numero = this.paso2.value.numero.trim().toLowerCase();
        const snap   = await getDocs(query(
          collection(this.firestore, 'usuarios'),
          where('domicilio.calleNorm', '==', calle),
          where('domicilio.numeroNorm', '==', numero),
          where('tipoUsuario', '==', 'titular')
        ));
        if (!snap.empty) {
          this.errorDireccion = 'Ya existe un titular registrado en esta dirección.';
          this.guardando = false;
          return;
        }
      } catch { this.guardando = false; return; }
    }

    this.errorDireccion = '';
    this.guardando      = true;
    const user = this.auth.currentUser;
    if (!user) return;
    try {
      await setDoc(doc(this.firestore, 'usuarios', user.uid), {
        domicilio: {
          calle:      this.paso2.value.calle,
          numero:     this.paso2.value.numero,
          colonia:    this.paso2.value.colonia,
          calleNorm:  this.paso2.value.calle.trim().toLowerCase(),
          numeroNorm: this.paso2.value.numero.trim().toLowerCase(),
          lat:        this.latitud,
          lng:        this.longitud
        }
      }, { merge: true });
    } catch {
      this.toast.error('Error al guardar. Intenta de nuevo.');
    } finally { this.guardando = false; }
  }

  async iniciarStripe() {
    setTimeout(async () => {
      this.stripe = await loadStripe('pk_test_51T5VjJKadJSbpyI8FjOVDIxEiAO5IGu5RShBdZJbUDlaOjmWEalVreB0Ngf3RKdxr63xVrELIpZVeivkprVOFmrB00NTCKjq3m');
      if (!this.stripe) return;
      const elements = this.stripe.elements();
      this.cardElement = elements.create('card', {
        hidePostalCode: true,
        style: {
          base: { color: '#ffffff', fontFamily: 'Segoe UI, sans-serif', fontSize: '16px',
            '::placeholder': { color: '#aaaaaa' }, iconColor: '#FF6B00' },
          invalid: { color: '#ff4444' }
        }
      });
      this.cardElement.mount('#stripe-card');
      this.cardElement.on('change', e => { this.stripeError = e.error ? e.error.message : ''; });
    }, 300);
  }

  async guardarMetodoPago() {
    if (!this.stripe || !this.cardElement) return;
    this.guardando   = true;
    this.stripeError = '';
    try {
      const { paymentMethod, error } = await this.stripe.createPaymentMethod({ type: 'card', card: this.cardElement });
      if (error) { this.stripeError = error.message || 'Error al procesar la tarjeta.'; return; }
      const user = this.auth.currentUser;
      if (!user) return;
      await setDoc(doc(this.firestore, 'usuarios', user.uid), {
        metodoPago: {
          id: paymentMethod!.id, marca: paymentMethod!.card?.brand,
          ultimos4: paymentMethod!.card?.last4,
          expMes: paymentMethod!.card?.exp_month, expAnio: paymentMethod!.card?.exp_year
        }
      }, { merge: true });
      this.pagoGuardado = true;
    } catch {
      this.stripeError = 'Error inesperado. Intenta de nuevo.';
    } finally { this.guardando = false; }
  }

  async finalizar() {
    const user = this.auth.currentUser;
    if (!user) return;
    this.guardando = true;
    try {
      await setDoc(doc(this.firestore, 'usuarios', user.uid), { perfilCompleto: true }, { merge: true });
      window.location.href = '/dashboard';
    } catch {
      this.toast.error('Error al finalizar. Intenta de nuevo.');
    } finally { this.guardando = false; }
  }
}