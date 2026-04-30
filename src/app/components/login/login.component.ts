import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Auth, signInWithEmailAndPassword, sendPasswordResetEmail } from '@angular/fire/auth';
import { Firestore, doc, getDoc, collection, query, where, getDocs } from '@angular/fire/firestore';
import { ToastService } from '../toast/toast.service';

// Roles permitidos para acceder a las áreas privadas
const ROLES_PERMITIDOS = ['admin', 'recolector', 'usuario'];

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  private auth      = inject(Auth);
  private firestore = inject(Firestore);
  private toast     = inject(ToastService);
  private router    = inject(Router);

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
      const uid       = userCredential.user.uid;
      const userEmail = (userCredential.user.email || email).toLowerCase();

      // 1. Buscar primero en la colección principal de usuarios
      let docSnap = await getDoc(doc(this.firestore, 'usuarios', uid));
      let data: any = docSnap.exists() ? docSnap.data() : null;
      let rol = data?.['rol'] || '';

      // 1b. Si el usuario existe en 'usuarios' pero sin rol privilegiado,
      //     puede haber sido aprobado como recolector después de registrarse.
      if (docSnap.exists() && rol !== 'admin' && rol !== 'recolector') {
        const recQuery = await getDocs(query(
          collection(this.firestore, 'recolectores'),
          where('email', '==', userEmail)
        ));
        if (!recQuery.empty && recQuery.docs[0].data()['activo'] !== false) {
          rol = 'recolector';
        }
      }

      // 2. Si no existe en usuarios, buscar en la colección de recolectores.
      //    El admin crea recolectores con addDoc() (ID auto-generado), por lo
      //    que NO se pueden buscar por UID — se buscan por email.
      if (!docSnap.exists()) {
        // 2a. Intento por UID (compatibilidad con docs antiguos)
        const recPorUid = await getDoc(doc(this.firestore, 'recolectores', uid));
        if (recPorUid.exists()) {
          data = recPorUid.data();
          rol  = data?.['rol'] || 'recolector';
        } else {
          // 2b. Búsqueda por email (caso real con addDoc)
          const recQuery = await getDocs(query(
            collection(this.firestore, 'recolectores'),
            where('email', '==', userEmail)
          ));
          if (!recQuery.empty) {
            data = recQuery.docs[0].data();
            rol  = data?.['rol'] || 'recolector';
          }
        }
      }

      // 3. Validar si la cuenta fue dada de baja (aplica para ambas colecciones)
      if (data && data['activo'] === false) {
        await this.auth.signOut();
        this.mensajeBloqueado = 'Tu cuenta ha sido dada de baja. Contacta al administrador.';
        return;
      }

      // 4. Si el rol no está en la lista de roles permitidos, lo tratamos como usuario
      if (rol && !ROLES_PERMITIDOS.includes(rol)) {
        rol = 'usuario';
      }

      // 5. Redirección basada en el rol detectado
      if (rol === 'admin') {
        this.router.navigate(['/admin']);
      } else if (rol === 'recolector') {
        this.router.navigate(['/recolector']);
      } else if (!data || !data['perfilCompleto']) {
        this.router.navigate(['/onboarding']);
      } else {
        this.router.navigate(['/dashboard']);
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