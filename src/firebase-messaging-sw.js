importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBDJMa90UKI0O4TnnCqxsexVnIh3hCDgCE",
  authDomain: "coliapor.firebaseapp.com",
  databaseURL: "https://coliapor-default-rtdb.firebaseio.com",
  projectId: "coliapor",
  storageBucket: "coliapor.firebasestorage.app",
  messagingSenderId: "522676947647",
  appId: "1:522676947647:web:7e6e6753ae244223d4d40a",
  measurementId: "G-14MXXD6XGS"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Mensaje recibido en segundo plano ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/icons/apple-icon-180.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});