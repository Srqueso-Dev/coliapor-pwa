import { Component, inject } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, sendEmailVerification, signOut } from '@angular/fire/auth';
import { RouterModule } from '@angular/router';
import { ToastService } from '../toast/toast.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  private auth  = inject(Auth);
  private toast = inject(ToastService);

  cargando = false;

  async registrar(nombre: string, email: string, pass: string, confirmar: string) {
    if (!nombre || !email || !pass || !confirmar) {
      this.toast.error('Por favor completa todos los campos.');
      return;
    }
    if (pass !== confirmar) {
      this.toast.error('Las contraseñas no coinciden.');
      return;
    }
    if (pass.length < 6) {
      this.toast.error('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    this.cargando = true;
    try {
      const credencial = await createUserWithEmailAndPassword(this.auth, email, pass);
      await sendEmailVerification(credencial.user);
      await signOut(this.auth);
      this.toast.ok('¡Cuenta creada! Revisa tu correo y verifica tu cuenta antes de iniciar sesión.');
      setTimeout(() => window.location.href = '/login', 2000);
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        this.toast.error('Este correo ya está registrado.');
      } else if (error.code === 'auth/invalid-email') {
        this.toast.error('El correo no es válido.');
      } else if (error.code === 'auth/weak-password') {
        this.toast.error('La contraseña es muy débil.');
      } else {
        this.toast.error('Error al crear la cuenta. Intenta de nuevo.');
      }
    } finally {
      this.cargando = false;
    }
  }
}