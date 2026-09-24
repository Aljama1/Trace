import { Injectable, inject, signal, computed, NgZone, runInInjectionContext, EnvironmentInjector, OnDestroy } from '@angular/core';
import { Firestore, collection, query, where, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, runTransaction } from '@angular/fire/firestore';
import { Comanda, EstadoComanda } from '../models/comanda.model';
import { UserSettingsService } from './user-settings.service';
import { AudioService } from './audio.service';
import { ProductoAdminService } from './producto-admin.service';
import { FacturacionService } from './facturacion.service';
import { getTranslation } from '../models/common.model';
import { FacturaLegal } from '../models/factura.model';

@Injectable({
  providedIn: 'root'
})
export class AdminComandaService implements OnDestroy {
  private firestore = inject(Firestore);
  private audioService = inject(AudioService);
  private productoAdminService = inject(ProductoAdminService);
  private facturacionService = inject(FacturacionService);
  private zona = inject(NgZone);
  private inyector = inject(EnvironmentInjector);

  // Señal maestra con TODAS las comandas activas (Pendientes, Preparando, Listas)
  private _comandasActivas = signal<Comanda[]>([]);

  // Computed: Clasificamos automáticamente en dos "cubos" para las pestañas
  pedidosPendientes = computed(() => this._comandasActivas().filter(c => c.estado === 'PENDIENTE'));
  pedidosEnCurso = computed(() => this._comandasActivas().filter(c => c.estado === 'PREPARANDO'));
  pedidosHistorial = computed(() => this._comandasActivas().filter(c => c.estado === 'SERVIDO').reverse());

  // Señal para la vista de tickets (Por Mesa) - Solo pedidos con destino COCINA en preparación
  pedidosCocina = computed(() => {
    return this._comandasActivas()
      .filter(c => c.estado === 'PREPARANDO')
      .filter(c => c.lineasComanda.some(l => l.destino === 'COCINA' && !l.preparado));
  });

  // Señal análoga para el Barman - Pedidos en preparación con bebidas pendientes
  pedidosBarra = computed(() => {
    return this._comandasActivas()
      .filter(c => c.estado === 'PREPARANDO')
      .filter(c => c.lineasComanda.some(l => l.destino === 'BARRA' && !l.preparado));
  });

  // Nueva señal para la vista agregada (Resumen de Producción)
  // Aquí juntamos todos los platos iguales de diferentes mesas para que el cocinero
  // sepa exactamente cuántas raciones totales tiene que hacer de cada cosa.
  productosAgregadosCocina = computed(() => {
    const mapa = new Map<string, { nombre: string, cantidadTotal: number, mesas: string[], notas: string[] }>();

    this.pedidosCocina().forEach(comanda => {
      comanda.lineasComanda
        .filter(l => l.destino === 'COCINA' && !l.preparado) // Ignoramos los que ya están listos
        .forEach(linea => {
          // Buscamos si ya tenemos este producto en el mapa
          const productoExistente = mapa.get(linea.idProducto);
          
          if (productoExistente) {
            // Si ya existe, sumamos la cantidad y guardamos de qué mesa viene
            productoExistente.cantidadTotal += linea.cantidad;
            if (!productoExistente.mesas.includes(comanda.idMesa)) {
              productoExistente.mesas.push(comanda.idMesa);
            }
            // Guardamos las notas si las hay (ej. "sin sal")
            if (linea.notasEspeciales) {
              productoExistente.notas.push(`Mesa ${comanda.idMesa}: ${linea.notasEspeciales}`);
            }
          } else {
            // Si es la primera vez que lo vemos, lo inicializamos
            mapa.set(linea.idProducto, {
              nombre: getTranslation(linea.nombreProducto, 'es'),
              cantidadTotal: linea.cantidad,
              mesas: [comanda.idMesa],
              notas: linea.notasEspeciales ? [`Mesa ${comanda.idMesa}: ${linea.notasEspeciales}`] : []
            });
          }
        });
    });

    // Devolvemos los valores del mapa como un array para poder iterarlos en el HTML con @for
    return Array.from(mapa.values());
  });

  // Bebidas agregadas por producto — el barman ve de un vistazo cuántas tiene que servir de cada cosa
  productosBarra = computed(() => {
    const mapa = new Map<string, { nombre: string, cantidadTotal: number, mesas: string[], notas: string[] }>();

    this.pedidosBarra().forEach(comanda => {
      comanda.lineasComanda
        .filter(l => l.destino === 'BARRA' && !l.preparado) // Solo bebidas pendientes
        .forEach(linea => {
          const existente = mapa.get(linea.idProducto);
          if (existente) {
            existente.cantidadTotal += linea.cantidad;
            if (!existente.mesas.includes(comanda.idMesa)) {
              existente.mesas.push(comanda.idMesa);
            }
            if (linea.notasEspeciales) {
              existente.notas.push(`Mesa ${comanda.idMesa}: ${linea.notasEspeciales}`);
            }
          } else {
            mapa.set(linea.idProducto, {
              nombre: getTranslation(linea.nombreProducto, 'es'),
              cantidadTotal: linea.cantidad,
              mesas: [comanda.idMesa],
              notas: linea.notasEspeciales ? [`Mesa ${comanda.idMesa}: ${linea.notasEspeciales}`] : []
            });
          }
        });
    });

    return Array.from(mapa.values());
  });

  // Mesas que han pulsado "Pedir la cuenta" desde la app del cliente
  mesasConSolicitudCuenta = computed(() => {
    const mesas = new Set<string>();
    this._comandasActivas().forEach(c => {
      if (c.solicitaCuenta === true) mesas.add(c.idMesa);
    });
    return Array.from(mesas).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  });

  hayPedidosPendientes = computed(() => this.pedidosPendientes().length > 0);
  hayPedidosEnCurso = computed(() => this.pedidosEnCurso().length > 0);
  hayPedidosHistorial = computed(() => this.pedidosHistorial().length > 0);
  hayPedidosCocina = computed(() => this.pedidosCocina().length > 0);
  hayPedidosBarra = computed(() => this.pedidosBarra().length > 0);

  private unsubscribeSnapshot: (() => void) | null = null;
  private activeListeners = 0; // Contador para saber cuántos componentes están usando la escucha

  private userSettings = inject(UserSettingsService);

  constructor() { }

  /**
   * Inicia la escucha en tiempo real de Firestore para comandas ACTIVAS.
   */
  iniciarEscuchaPedidosEntrantes() {
    this.activeListeners++;
    
    // Si ya hay un listener activo, no creamos otro
    if (this.unsubscribeSnapshot) {
      return;
    }

    runInInjectionContext(this.inyector, () => {
      const comandasRef = collection(this.firestore, 'comandas');
      
      // Consulta: Traemos 4 estados a la vez. 
      const q = query(
        comandasRef,
        where('estado', 'in', ['PENDIENTE', 'PREPARANDO', 'SERVIDO']),
        orderBy('fechaCreacion', 'asc')
      );

      let isInitialLoad = true;

      this.unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        this.zona.run(() => {
          // Lógica de notificaciones sonoras para pedidos nuevos
          if (!isInitialLoad && this.userSettings.soundEnabled()) {
            snapshot.docChanges().forEach(change => {
              if (change.type === 'added') {
                const data = change.doc.data() as Comanda;
                if (data.estado === 'PENDIENTE') {
                  this.reproducirPing();
                }
              }
            });
          }
          isInitialLoad = false;

          const pedidos: Comanda[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data() as any;
            const data: Comanda = {
              ...raw,
              id: docSnap.id,
              fechaCreacion: raw.fechaCreacion?.toMillis?.() ?? raw.fechaCreacion ?? 0,
              fechaActualizacion: raw.fechaActualizacion?.toMillis?.() ?? raw.fechaActualizacion ?? 0,
            };
            pedidos.push(data);
          });
          // Actualiza la señal maestra, Angular recalcula automáticamente pendientes y enCurso
          this._comandasActivas.set(pedidos);
        });
      }, (error) => {
        this.zona.run(() => {
          console.error('Error escuchando pedidos activos:', error);
        });
      });
    });
  }

  detenerEscucha() {
    if (this.activeListeners <= 0) return;
    this.activeListeners--;

    if (this.activeListeners === 0) {
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
        this.unsubscribeSnapshot = null;
      }
      this._comandasActivas.set([]);
    }
  }

  /**
   * Cambia dinámicamente el estado de una comanda.
   */
  async actualizarEstado(idComanda: string, nuevoEstado: EstadoComanda): Promise<void> {
    const docRef = doc(this.firestore, `comandas/${idComanda}`);
    try {
      await updateDoc(docRef, {
        estado: nuevoEstado,
        fechaActualizacion: serverTimestamp()
      });
    } catch (error) {
      console.error(`Error al actualizar a ${nuevoEstado}:`, error);
      throw error;
    }
  }

  /**
   * Marca un plato específico de una comanda como preparado o no.
   *
   * Usa una transacción Firestore para leer el documento fresco antes de
   * sobreescribir `lineasComanda`. Esto evita la race condition en la que
   * cocina y barra tickean líneas distintas de la misma comanda al mismo
   * tiempo y una pisa el tick de la otra.
   *
   * Si al marcarla se completan todos los platos (cocina + barra), el estado
   * global de la comanda pasa a SERVIDO de forma automática.
   */
  async marcarLineaPreparada(idComanda: string, indexLinea: number, preparado: boolean): Promise<void> {
    const docRef = doc(this.firestore, `comandas/${idComanda}`);
    const localComanda = this._comandasActivas().find(c => c.id === idComanda);
    const lineaAnterior = localComanda?.lineasComanda[indexLinea];
    if (!lineaAnterior) return;

    try {
      await runInInjectionContext(this.inyector, () =>
        runTransaction(this.firestore, async (tx) => {
          const snap = await tx.get(docRef);
          if (!snap.exists()) throw new Error('Comanda no encontrada');
          const data = snap.data() as Comanda;
          const lineas = [...data.lineasComanda];
          if (indexLinea < 0 || indexLinea >= lineas.length) return;

          lineas[indexLinea] = { ...lineas[indexLinea], preparado };

          const cocinaBarra = lineas.filter(l => l.destino === 'COCINA' || l.destino === 'BARRA');
          const todosListos = cocinaBarra.length > 0 && cocinaBarra.every(l => l.preparado);

          const updates: { lineasComanda: typeof lineas; fechaActualizacion: unknown; estado?: EstadoComanda } = {
            lineasComanda: lineas,
            fechaActualizacion: serverTimestamp()
          };
          if (todosListos) updates.estado = 'SERVIDO';
          tx.update(docRef, updates);
        })
      );

      // Stock se descuenta SOLO si la transacción tuvo éxito y es la primera
      // vez que se marca esta línea como preparada. Si la transacción falla
      // por conflicto Firestore reintenta automáticamente, así que llegar
      // aquí significa que el tick está persistido.
      if (preparado && !lineaAnterior.preparado) {
        await this.productoAdminService.descontarStock(lineaAnterior.idProducto, lineaAnterior.cantidad);
      }
    } catch (error) {
      console.error('Error al marcar plato preparado:', error);
      throw error;
    }
  }

  /**
   * Edita una línea específica de una comanda y recalcula el total.
   * Usa transacción para basar el cálculo en el array de líneas vigente en
   * Firestore (no en el snapshot local), evitando que dos ediciones simultáneas
   * desde dos terminales se pisen.
   */
  async editarLineaComanda(idComanda: string, indexLinea: number, nuevosDatos: { cantidad?: number; precioUnitario?: number }): Promise<void> {
    const docRef = doc(this.firestore, `comandas/${idComanda}`);
    await runInInjectionContext(this.inyector, () =>
      runTransaction(this.firestore, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) throw new Error('Comanda no encontrada');
        const data = snap.data() as Comanda;
        const lineas = [...data.lineasComanda];
        if (indexLinea < 0 || indexLinea >= lineas.length) return;

        const linea = { ...lineas[indexLinea] };
        if (nuevosDatos.cantidad !== undefined) linea.cantidad = nuevosDatos.cantidad;
        if (nuevosDatos.precioUnitario !== undefined) linea.precioUnitario = nuevosDatos.precioUnitario;
        linea.subtotal = linea.cantidad * linea.precioUnitario;
        lineas[indexLinea] = linea;

        const nuevoTotal = lineas.reduce((sum, l) => sum + l.subtotal, 0);
        tx.update(docRef, {
          lineasComanda: lineas,
          precioTotal: nuevoTotal,
          fechaActualizacion: serverTimestamp()
        });
      })
    );
  }

  /**
   * Elimina una línea de una comanda y recalcula el total dentro de una
   * transacción. Si tras la eliminación no quedan líneas, marca la comanda
   * como CANCELADO.
   */
  async eliminarLineaComanda(idComanda: string, indexLinea: number): Promise<void> {
    const docRef = doc(this.firestore, `comandas/${idComanda}`);
    await runInInjectionContext(this.inyector, () =>
      runTransaction(this.firestore, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) throw new Error('Comanda no encontrada');
        const data = snap.data() as Comanda;
        const lineas = [...data.lineasComanda];
        if (indexLinea < 0 || indexLinea >= lineas.length) return;

        lineas.splice(indexLinea, 1);
        const nuevoTotal = lineas.reduce((sum, l) => sum + l.subtotal, 0);

        if (lineas.length === 0) {
          tx.update(docRef, {
            lineasComanda: [],
            precioTotal: 0,
            estado: 'CANCELADO',
            fechaActualizacion: serverTimestamp()
          });
        } else {
          tx.update(docRef, {
            lineasComanda: lineas,
            precioTotal: nuevoTotal,
            fechaActualizacion: serverTimestamp()
          });
        }
      })
    );
  }

  /**
   * Genera una factura para todas las comandas activas de una mesa.
   *
   * Delega toda la lógica de facturación (cálculos, encadenamiento SHA-256,
   * transacciones) a FacturacionService para separar responsabilidades.
   *
   * @param idMesa - ID de la mesa
   * @param metodoPago - Método de pago utilizado
   * @returns FacturaLegal generada con todos los detalles
   */
  async generarFactura(idMesa: string, metodoPago: string): Promise<FacturaLegal> {
    return this.facturacionService.generarFactura(idMesa, metodoPago);
  }

  /**
   * Obtiene todas las comandas activas de una mesa específica.
   * Usado internamente por FacturacionService y otros servicios administrativos.
   *
   * @param idMesa - ID de la mesa
   * @returns Array de comandas de esa mesa
   */
  obtenerComandasPorMesa(idMesa: string): Comanda[] {
    return this._comandasActivas().filter(c => c.idMesa === idMesa);
  }

  /**
   * Reproduce un sonido (ping) mediante el servicio de audio.
   */
  private reproducirPing() {
    this.audioService.reproducirPing();
  }

  ngOnDestroy(): void {
    this.detenerEscucha();
  }
}
