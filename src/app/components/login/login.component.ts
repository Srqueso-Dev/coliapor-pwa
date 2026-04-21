import { Component, inject } from '@angular/core'; // ← El error estaba aquí
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private toast = inject(ToastService);

  cargando = false;

  form: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  async login() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.cargando = true;
    const { email, password } = this.form.value;

    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      const user = userCredential.user;

      // Obtener el documento del usuario para ver el ROL
      const snap = await getDoc(doc(this.firestore, 'usuarios', user.uid));
      
      if (snap.exists()) {
        const data = snap.data();
        const rol = data['rol'];

        console.log('Usuario logueado con rol:', rol);

        // REDIRECCIÓN CRÍTICA
        if (rol === 'admin') {
          this.router.navigate(['/admin']);
        } else if (rol === 'recolector') {
          this.router.navigate(['/recolector']);
        } else {
          // Si es ciudadano común
          if (data['perfilCompleto']) {
            this.router.navigate(['/dashboard']);
          } else {
            this.router.navigate(['/onboarding']);
          }
        }
      } else {
        // Si no hay documento (error raro), mandarlo a onboarding
        this.router.navigate(['/onboarding']);
      }

    } catch (error: any) {
      this.toast.error('Credenciales incorrectas o cuenta inexistente.');
      console.error(error);
    } finally {
      this.cargando = false;
    }
  }
}