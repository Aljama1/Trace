import { Injectable, signal, inject, effect } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/**
 * Servicio global para gestionar preferencias del usuario cliente:
 * - Modo oscuro (dark mode)
 *
 * Persiste las preferencias en localStorage.
 * Se usa desde el modal de configuración accesible en todas las páginas de cliente.
 */
@Injectable({
  providedIn: 'root'
})
export class UserSettingsService {
  private document = inject(DOCUMENT);

  // ── Dark Mode ──────────────────────────────────────────────────────
  isDark = signal<boolean>(
    localStorage.getItem('trace-dark-mode') === 'true'
  );

  // ── Sonidos ────────────────────────────────────────────────────────
  soundEnabled = signal<boolean>(
    localStorage.getItem('trace-sound-enabled') !== 'false' // Por defecto true
  );

  constructor() {
    // Aplicar el estado inicial al DOM
    this.document.documentElement.classList.toggle('ion-palette-dark', this.isDark());
    this.document.body.classList.toggle('dark', this.isDark());

    // Sincronizar cambios de Dark Mode
    effect(() => {
      const dark = this.isDark();
      this.document.documentElement.classList.toggle('ion-palette-dark', dark);
      this.document.body.classList.toggle('dark', dark);
      localStorage.setItem('trace-dark-mode', String(dark));
    });

    // Sincronizar cambios de Sonido
    effect(() => {
      localStorage.setItem('trace-sound-enabled', String(this.soundEnabled()));
    });
  }

  toggleDark(): void {
    this.isDark.update(v => !v);
  }

  toggleSound(): void {
    this.soundEnabled.update(v => !v);
  }
}


