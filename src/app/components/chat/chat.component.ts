import { Component, inject, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import {
  Firestore, collection, addDoc, query, orderBy,
  onSnapshot, serverTimestamp, doc, getDoc, getDocs, deleteDoc, Timestamp
} from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';

const PALABRAS_PROHIBIDAS = [
  'puta', 'puto', 'pendejo', 'pendeja', 'chinga', 'chingada', 'cabrón',
  'cabron', 'mierda', 'culo', 'verga', 'pene', 'mamada', 'joder', 'coño'
];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css'
})
export class ChatComponent implements OnInit, OnDestroy {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private toast     = inject(ToastService);

  @ViewChild('mensajesContainer') mensajesContainer!: ElementRef;

  mensajes: any[] = [];
  nuevoMensaje    = '';
  colonia         = '';
  nombreUsuario   = '';
  uid             = '';
  cargando        = true;
  enviando        = false;
  errorMsg        = '';

  private unsub: (() => void) | null = null;

  ngOnInit() {
    this.auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = '/login'; return; }
      this.uid = user.uid;

      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        this.colonia       = data['domicilio']?.colonia || '';
        this.nombreUsuario = data['nombre'] || 'Usuario';
      }

      if (!this.colonia) { this.cargando = false; return; }

      // Borrar mensajes con más de 7 días al entrar
      await this.borrarMensajesViejos();

      this.escucharMensajes();
    });
  }

  ngOnDestroy() {
    if (this.unsub) this.unsub();
  }

  async borrarMensajesViejos() {
    try {
      const hace7dias = new Date();
      hace7dias.setDate(hace7dias.getDate() - 7);

      const snap = await getDocs(
        query(collection(this.firestore, `chat/${this.colonia}/mensajes`), orderBy('fecha', 'asc'))
      );

      const viejos = snap.docs.filter(d => {
        const fecha = d.data()['fecha'] as Timestamp;
        if (!fecha?.toDate) return false;
        return fecha.toDate() < hace7dias;
      });

      for (const d of viejos) {
        await deleteDoc(doc(this.firestore, `chat/${this.colonia}/mensajes`, d.id));
      }
    } catch { }
  }

  escucharMensajes() {
    const ref = collection(this.firestore, `chat/${this.colonia}/mensajes`);
    const q   = query(ref, orderBy('fecha', 'asc'));

    this.unsub = onSnapshot(q, snap => {
      this.mensajes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this.cargando = false;
      setTimeout(() => this.scrollAbajo(), 50);
    });
  }

  esMio(msg: any): boolean {
    return msg.uid === this.uid;
  }

  contieneProhibidas(texto: string): boolean {
    const lower = texto.toLowerCase();
    return PALABRAS_PROHIBIDAS.some(p => lower.includes(p));
  }

  async enviar() {
    const texto = this.nuevoMensaje.trim();
    if (!texto || this.enviando) return;
    if (texto.length > 300) {
      this.errorMsg = 'El mensaje no puede superar 300 caracteres.';
      return;
    }
    if (this.contieneProhibidas(texto)) {
      this.errorMsg = 'Tu mensaje contiene palabras no permitidas.';
      return;
    }

    this.errorMsg = '';
    this.enviando = true;
    try {
      await addDoc(collection(this.firestore, `chat/${this.colonia}/mensajes`), {
        uid:    this.uid,
        nombre: this.nombreUsuario,
        texto,
        colonia: this.colonia,
        fecha:  serverTimestamp()
      });
      this.nuevoMensaje = '';
    } catch {
      this.toast.error('Error al enviar el mensaje. Intenta de nuevo.');
    } finally {
      this.enviando = false;
    }
  }

  onEnter(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.enviar();
    }
  }

  scrollAbajo() {
    if (this.mensajesContainer?.nativeElement) {
      this.mensajesContainer.nativeElement.scrollTop =
        this.mensajesContainer.nativeElement.scrollHeight;
    }
  }

  formatearFecha(fecha: any): string {
    if (!fecha?.toDate) return '';
    const d = fecha.toDate();
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }
}