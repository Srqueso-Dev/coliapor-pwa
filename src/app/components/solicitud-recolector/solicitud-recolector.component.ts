import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Firestore, addDoc, collection } from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';

@Component({
  selector: 'app-solicitud-recolector',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './solicitud-recolector.component.html',
  styleUrl: './solicitud-recolector.component.css'
})
export class SolicitudRecolectorComponent {
  private firestore = inject(Firestore);
  private toast     = inject(ToastService);
  private fb        = inject(FormBuilder);

  enviado   = false;
  enviando  = false;

  form: FormGroup = this.fb.group({
    nombre:    ['', [Validators.required, Validators.minLength(3),
                     Validators.pattern(/^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]+$/)]],
    telefono:  ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
    email:     ['', [Validators.required, Validators.email]],
    zona:      ['', Validators.required],
    licencia:  ['', Validators.required],
    mensaje:   ['']
  });

  validarSoloLetras(event: KeyboardEvent) {
    const regex = /^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ\s]+$/;
    if (event.key.length === 1 && !regex.test(event.key)) {
      event.preventDefault();
    }
  }

  async enviar() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.enviando = true;
    try {
      await addDoc(collection(this.firestore, 'solicitudesRecolector'), {
        ...this.form.value,
        estado:    'pendiente',
        creadoEn:  new Date()
      });
      this.enviado = true;
    } catch {
      this.toast.error('Error al enviar la solicitud. Intenta de nuevo.');
    } finally {
      this.enviando = false;
    }
  }
}