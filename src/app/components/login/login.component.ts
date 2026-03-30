import { Component, inject, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Auth, signInWithEmailAndPassword, sendPasswordResetEmail } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { CommonModule } from '@angular/common';
import { ToastService } from '../toast/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private toast     = inject(ToastService);

  mensajeBloqueado = '';
  cargando         = false;

  ngOnInit() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('bloqueado') === 'true') {
      this.mensajeBloqueado = 'Tu cuenta ha sido dada de baja. Contacta al administrador.';
    }
  }

  async ingresar(email: string, pass: string) {
    if (!email || !pass) {
      this.toast.error('Por favor ingresa tu correo y contraseña.');
      return;
    }
    this.cargando = true;
    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email, pass);

      if (!userCredential.user.emailVerified) {
        this.toast.info('Debes verificar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.');
        await this.auth.signOut();
        return;
      }

      const uid     = userCredential.user.uid;
      const docSnap = await getDoc(doc(this.firestore, 'usuarios', uid));

      if (docSnap.exists() && docSnap.data()['activo'] === false) {
        await this.auth.signOut();
        this.mensajeBloqueado = 'Tu cuenta ha sido dada de baja. Contacta al administrador.';
        return;
      }

      if (!docSnap.exists() || !docSnap.data()['perfilCompleto']) {
        window.location.href = '/onboarding';
      } else {
        window.location.href = '/dashboard';
      }

    } catch (error: any) {
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        this.toast.error('Correo o contraseña incorrectos.');
      } else if (error.code === 'auth/user-not-found') {
        this.toast.error('No existe una cuenta con ese correo.');
      } else if (error.code === 'auth/too-many-requests') {
        this.toast.error('Demasiados intentos fallidos. Intenta más tarde.');
      } else {
        this.toast.error('Error al iniciar sesión. Intenta de nuevo.');
      }
    } finally {
      this.cargando = false;
    }
  }

  async olvideMiContrasena(email: string) {
    if (!email) {
      this.toast.info('Ingresa tu correo primero en el campo de arriba.');
      return;
    }
    try {
      await sendPasswordResetEmail(this.auth, email);
      this.toast.ok('Te enviamos un correo para restablecer tu contraseña.');
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        this.toast.error('No existe una cuenta con ese correo.');
      } else {
        this.toast.error('Error al enviar el correo. Intenta de nuevo.');
      }
    }
  }
}