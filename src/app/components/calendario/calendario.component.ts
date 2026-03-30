import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, getDocs, query, orderBy } from '@angular/fire/firestore';

interface FechaRecoleccion {
  id: string;
  fecha: string;
  hora: string;
  zona: string;
  descripcion?: string;
}

const CACHE_FECHAS = 'coliapor_fechas';

@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './calendario.component.html',
  styleUrl: './calendario.component.css'
})
export class CalendarioComponent implements OnInit {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);

  fechas: FechaRecoleccion[]          = [];
  fechasFiltradas: FechaRecoleccion[] = [];
  diasCalendario: (FechaRecoleccion | null)[] = [];
  cargando  = true;
  offline   = false;
  desdeCache = false;

  mesActual  = new Date();
  diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  meses      = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  ngOnInit() {
    this.offline = !navigator.onLine;
    window.addEventListener('online',  () => { this.offline = false; this.cargarFechas(); });
    window.addEventListener('offline', () => { this.offline = true; });

    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      await this.cargarFechas();
    });
  }

  async cargarFechas() {
    this.cargando = true;
    try {
      if (navigator.onLine) {
        const snap = await getDocs(query(
          collection(this.firestore, 'fechasRecoleccion'),
          orderBy('fecha')
        ));
        this.fechas = snap.docs.map(d => ({ id: d.id, ...d.data() } as FechaRecoleccion));
        // Guardar en caché
        localStorage.setItem(CACHE_FECHAS, JSON.stringify(this.fechas));
        this.desdeCache = false;
      } else {
        // Cargar desde caché
        const raw = localStorage.getItem(CACHE_FECHAS);
        if (raw) {
          this.fechas     = JSON.parse(raw);
          this.desdeCache = true;
        }
      }
      this.construirCalendario();
    } catch (e) {
      // Si falla Firestore, intentar caché
      const raw = localStorage.getItem(CACHE_FECHAS);
      if (raw) {
        this.fechas     = JSON.parse(raw);
        this.desdeCache = true;
        this.construirCalendario();
      }
    } finally {
      this.cargando = false;
    }
  }

  construirCalendario() {
    const anio = this.mesActual.getFullYear();
    const mes  = this.mesActual.getMonth();
    const primerDia = new Date(anio, mes, 1).getDay();
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    const mesStr    = `${anio}-${String(mes + 1).padStart(2, '0')}`;

    this.fechasFiltradas = this.fechas.filter(f => f.fecha.startsWith(mesStr));
    this.diasCalendario  = [];

    for (let i = 0; i < primerDia; i++) this.diasCalendario.push(null);

    for (let dia = 1; dia <= diasEnMes; dia++) {
      const fechaStr = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      const evento   = this.fechasFiltradas.find(f => f.fecha === fechaStr) || null;
      this.diasCalendario.push(evento ?? { id: '', fecha: fechaStr, hora: '', zona: '' });
    }
  }

  mesAnterior()  { this.mesActual = new Date(this.mesActual.getFullYear(), this.mesActual.getMonth() - 1, 1); this.construirCalendario(); }
  mesSiguiente() { this.mesActual = new Date(this.mesActual.getFullYear(), this.mesActual.getMonth() + 1, 1); this.construirCalendario(); }

  getDia(fecha: string)     { return parseInt(fecha.split('-')[2]); }
  esHoy(fecha: string)      { return fecha === new Date().toISOString().split('T')[0]; }
  tieneEvento(item: any)    { return item && item.hora !== ''; }
  esPasado(fecha: string)   { return fecha < new Date().toISOString().split('T')[0]; }

  get tituloMes()      { return `${this.meses[this.mesActual.getMonth()]} ${this.mesActual.getFullYear()}`; }
  get proximasFechas() {
    const hoy = new Date().toISOString().split('T')[0];
    return this.fechas.filter(f => f.fecha >= hoy).slice(0, 5);
  }
}