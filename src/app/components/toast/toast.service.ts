import { Injectable, signal } from '@angular/core';

export interface ToastData {
  id: number;
  mensaje: string;
  tipo: 'ok' | 'error' | 'info' | 'confirm';
  resolveFn?: (value: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<ToastData[]>([]);
  private contador = 0;

  ok(mensaje: string) {
    this._agregar({ mensaje, tipo: 'ok' });
  }

  error(mensaje: string) {
    this._agregar({ mensaje, tipo: 'error' });
  }

  info(mensaje: string) {
    this._agregar({ mensaje, tipo: 'info' });
  }

  confirmar(mensaje: string): Promise<boolean> {
    return new Promise(resolve => {
      this._agregar({ mensaje, tipo: 'confirm', resolveFn: resolve });
    });
  }

  private _agregar(data: Omit<ToastData, 'id'>) {
    const id = ++this.contador;
    this.toasts.update(t => [...t, { id, ...data }]);
    if (data.tipo !== 'confirm') {
      setTimeout(() => this.quitar(id), 3500);
    }
  }

  quitar(id: number) {
    this.toasts.update(t => t.filter(x => x.id !== id));
  }

  responderConfirm(id: number, valor: boolean) {
    const toast = this.toasts().find(t => t.id === id);
    if (toast?.resolveFn) toast.resolveFn(valor);
    this.quitar(id);
  }
}