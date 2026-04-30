import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class NotificacionesService {
  private messaging: any;

  constructor() {
    const app = initializeApp(environment.firebaseConfig);
    this.messaging = getMessaging(app);
  }

  solicitarPermiso() {
    console.log('Solicitando permiso para notificaciones...');
    
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        console.log('Permiso concedido.');
        this.obtenerToken();
      } else {
        console.log('Permiso denegado.');
      }
    });
  }

  private obtenerToken() {
    getToken(this.messaging, { vapidKey: environment.vapidKey })
      .then((currentToken) => {
        if (currentToken) {
          console.log('Token de FCM obtenido:', currentToken);
        } else {
          console.log('No se pudo obtener el token. Revisa los permisos.');
        }
      })
      .catch((err) => {
        console.error('Error al obtener el token', err);
      });
  }

  escucharMensajesActivos() {
    onMessage(this.messaging, (payload) => {
      console.log('Mensaje recibido en primer plano:', payload);
    });
  }
}