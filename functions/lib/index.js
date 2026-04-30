"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifPagoVencer = exports.notifDiaAnterior = exports.onNuevoAviso = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
// ─── Helpers ────────────────────────────────────────────────────────────────
async function tokensDeColonia(colonia) {
    const snap = await db.collection('usuarios')
        .where('notificacionesActivas', '==', true)
        .where('domicilio.colonia', '==', colonia)
        .get();
    return snap.docs
        .map(d => d.data()['fcmToken'])
        .filter(t => !!t);
}
async function enviarFCM(tokens, titulo, cuerpo) {
    if (!tokens.length)
        return;
    const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: titulo, body: cuerpo },
        webpush: { notification: { icon: '/assets/icons/apple-icon-180.png' } }
    });
    // Limpiar tokens inválidos para no acumular basura en Firestore
    const invalidos = res.responses
        .map((r, i) => (!r.success ? tokens[i] : null))
        .filter(Boolean);
    if (invalidos.length) {
        const batch = db.batch();
        const snap = await db.collection('usuarios')
            .where('fcmToken', 'in', invalidos).get();
        snap.docs.forEach(d => batch.update(d.ref, { fcmToken: null, notificacionesActivas: false }));
        await batch.commit();
    }
}
// ─── CF 1: Nuevo aviso del recolector → notificar a la colonia ─────────────
// Trigger: cuando el recolector escribe en /avisos/{id}
exports.onNuevoAviso = (0, firestore_1.onDocumentCreated)('avisos/{avisoId}', async (event) => {
    var _a;
    const aviso = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!aviso || aviso['enviado'] === true)
        return;
    const tokens = await tokensDeColonia(aviso['colonia']);
    await enviarFCM(tokens, aviso['titulo'], aviso['cuerpo']);
    await event.data.ref.update({ enviado: true });
});
// ─── CF 2: Notificación el día anterior a una recolección ──────────────────
// Cron: todos los días a las 19:00 hora de México
exports.notifDiaAnterior = (0, scheduler_1.onSchedule)({ schedule: '0 19 * * *', timeZone: 'America/Mexico_City' }, async () => {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().split('T')[0];
    const snap = await db.collection('fechasRecoleccion')
        .where('fecha', '==', mananaStr)
        .get();
    for (const fechaDoc of snap.docs) {
        const f = fechaDoc.data();
        const colonia = (f['colonia'] || f['zona'] || '').trim();
        if (!colonia)
            continue;
        const hora = f['hora'] ? ` a las ${f['hora']}` : '';
        const tokens = await tokensDeColonia(colonia);
        await enviarFCM(tokens, 'Recolección mañana', `Mañana hay recolección de basura${hora} en tu colonia. ¡Prepara tu bolsa!`);
    }
});
// ─── CF 3: Aviso de pago próximo a vencer (30 días desde el último pago) ───
// Cron: todos los días a las 08:00 hora de México
exports.notifPagoVencer = (0, scheduler_1.onSchedule)({ schedule: '0 8 * * *', timeZone: 'America/Mexico_City' }, async () => {
    const snap = await db.collection('usuarios')
        .where('notificacionesActivas', '==', true)
        .get();
    for (const userDoc of snap.docs) {
        const data = userDoc.data();
        const token = data['fcmToken'];
        if (!token)
            continue;
        const pagos = (data['pagos'] || {});
        const claves = Object.keys(pagos).sort().reverse();
        if (!claves.length)
            continue;
        const ultimoPago = pagos[claves[0]];
        // Preferir fechaISO (ISO yyyy-mm-dd), con fallback a fecha 'dd/mm/yyyy'
        let fechaPago = null;
        if (ultimoPago === null || ultimoPago === void 0 ? void 0 : ultimoPago.fechaISO) {
            fechaPago = new Date(ultimoPago.fechaISO + 'T00:00:00');
        }
        else if (ultimoPago === null || ultimoPago === void 0 ? void 0 : ultimoPago.fecha) {
            const partes = ultimoPago.fecha.split('/');
            if (partes.length === 3) {
                fechaPago = new Date(+partes[2], +partes[1] - 1, +partes[0]);
            }
        }
        if (!fechaPago || isNaN(fechaPago.getTime()))
            continue;
        const vencimiento = new Date(fechaPago.getTime() + 30 * 24 * 60 * 60 * 1000);
        const diasRestantes = Math.ceil((vencimiento.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (diasRestantes >= 1 && diasRestantes <= 5) {
            await messaging.send({
                token,
                notification: {
                    title: 'Pago próximo a vencer',
                    body: `Tu suscripción vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}. Realiza tu pago para mantener el servicio.`
                },
                webpush: { notification: { icon: '/assets/icons/apple-icon-180.png' } }
            });
        }
    }
});
//# sourceMappingURL=index.js.map