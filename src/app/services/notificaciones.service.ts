import { Injectable, inject } from '@angular/core';
import { getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, deleteToken } from 'firebase/messaging';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private messaging: any;
  private firestore = inject(Firestore);
  private static foregroundRegistrado = false;

  constructor() {
    this.messaging = getMessaging(getApp());
  }

  // Solicita permiso, obtiene token y lo guarda en Firestore.
  async activar(uid: string): Promise<boolean> {
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') return false;
      return this.refrescarToken(uid);
    } catch (e) {
      console.error('Error al activar notificaciones:', e);
      return false;
    }
  }

  // Refresca el token silenciosamente (permiso ya concedido).
  // Llamar en cada login para mantener el token actualizado.
  async refrescarToken(uid: string): Promise<boolean> {
    try {
      const token = await getToken(this.messaging, { vapidKey: environment.vapidKey });
      if (!token) return false;
      await setDoc(doc(this.firestore, 'usuarios', uid), {
        fcmToken: token,
        notificacionesActivas: true
      }, { merge: true });
      return true;
    } catch (e) {
      console.error('Error al refrescar token FCM:', e);
      return false;
    }
  }

  // Desactiva notificaciones y borra el token de Firestore.
  async desactivar(uid: string): Promise<void> {
    try { await deleteToken(this.messaging); } catch {}
    await setDoc(doc(this.firestore, 'usuarios', uid), {
      fcmToken: null,
      notificacionesActivas: false
    }, { merge: true });
  }

  // Registra el handler de mensajes en primer plano (llamar una sola vez al iniciar sesión).
  escucharForeground(): void {
    if (NotificacionesService.foregroundRegistrado) return;
    NotificacionesService.foregroundRegistrado = true;
    onMessage(this.messaging, payload => {
      this.mostrarLocal(
        payload.notification?.title ?? 'Coliapor',
        payload.notification?.body  ?? ''
      );
    });
  }

  // Muestra una notificación local a través del service worker (funciona en primer plano).
  mostrarLocal(titulo: string, cuerpo: string): void {
    if (Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg =>
        reg.showNotification(titulo, {
          body: cuerpo,
          icon: '/assets/icons/apple-icon-180.png'
        })
      );
    } else {
      new Notification(titulo, { body: cuerpo });
    }
  }

  // ─── Legacy stubs (para compatibilidad con RecolectorComponent) ───────────
  solicitarPermiso(): void {}
  escucharMensajesActivos(): void {}
}
