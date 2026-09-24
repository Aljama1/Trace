import { Injectable, inject, Injector, NgZone, runInInjectionContext, EnvironmentInjector } from '@angular/core';
import {
  Firestore, collection, doc, runTransaction, serverTimestamp
} from '@angular/fire/firestore';
import { FacturaLegal, ContadorFacturas, calcularDesgloseIva, generarHashFactura } from '../models/factura.model';
import { AdminComandaService } from './admin-comanda.service';
import { Comanda } from '../models/comanda.model';
import { getTranslation } from '../models/common.model';

/**
 * Servicio especializado en la generación de facturas con encadenamiento SHA-256 e integridad técnica.
 *
 * Responsabilidades:
 *  1. Calcular el total de consumición de una mesa
 *  2. Generar número de factura correlativo con serie
 *  3. Encadenar hashes SHA-256 para integridad de registros
 *  4. Realizar transacción atómica (factura + contador)
 *  5. Marcar comandas como pagadas al finalizar
 *
 * Extrae la responsabilidad de facturación del AdminComandaService para mejorar:
 *  - Mantenibilidad: Lógica de facturación centralizada
 *  - Testabilidad: Fácil de unit-testear sin cargar AdminComandaService
 *  - Reusabilidad: Otro componente puede generar facturas sin conocer AdminComanda
 *
 * Nota: Mantiene alta cohesión con AdminComandaService (necesita acceso a _comandasActivas)
 * y finalizarCuentaMesa() para completar el ciclo de cierre de mesa.
 */
@Injectable({
  providedIn: 'root'
})
export class FacturacionService {
  private firestore = inject(Firestore);
  private injector = inject(Injector);
  private zona = inject(NgZone);
  private inyector = inject(EnvironmentInjector);

  /**
   * Resolución lazy de AdminComandaService para evitar dependencia circular
   * (AdminComandaService → FacturacionService → AdminComandaService).
   * El Injector.get sólo se ejecuta cuando se invoca un método, momento en el
   * que ambos servicios ya están instanciados.
   */
  private get adminComandaService(): AdminComandaService {
    return this.injector.get(AdminComandaService);
  }

  /**
   * Genera una factura legal para todas las comandas activas de una mesa.
   *
   * Proceso:
   *  1. Recolecta todas las comandas de la mesa
   *  2. Calcula total con desglose de IVA
   *  3. Lee el contador de facturas actual
   *  4. Genera número correlativo (formato: SERIE-000001)
   *  5. Encadena hash SHA-256 con factura anterior
   *  6. Persiste factura + actualiza contador en transacción atómica
   *  7. Marca todas las comandas de la mesa como PAGADO
   *
   * @param idMesa - ID de la mesa para la que se genera factura
   * @param metodoPago - Método usado (Efectivo, Tarjeta, etc.)
   * @returns FacturaLegal con número, hashes y detalles del consumo
   *
   * @throws Error si no hay consumiciones, contador no existe, o transacción falla
   */
  async generarFactura(idMesa: string, metodoPago: string): Promise<FacturaLegal> {
    // Identificamos las comandas a cerrar a partir del snapshot local; los
    // CÁLCULOS (total, productos, hash) se basarán después en lecturas frescas
    // dentro de la transacción para garantizar coherencia con el documento real.
    const comandasLocales = this.adminComandaService.obtenerComandasPorMesa(idMesa);

    if (comandasLocales.length === 0) {
      throw new Error(`No hay consumiciones registradas para la mesa ${idMesa}`);
    }

    const refContador = doc(this.firestore, 'metadatos/contadores_facturas');
    const refNuevaFactura = doc(collection(this.firestore, 'facturas'));
    const refsComandas = comandasLocales
      .filter(c => !!c.id)
      .map(c => doc(this.firestore, `comandas/${c.id}`));

    try {
      const facturaGenerada = await runInInjectionContext(this.inyector, () =>
        runTransaction(this.firestore, async (transaccion) => {
          // ─── 1. LECTURAS (todas antes de cualquier escritura) ───────────
          const docContador = await transaccion.get(refContador);
          if (!docContador.exists()) {
            throw new Error(
              'Error crítico: Contador de facturas no existe. ' +
              'Crea el documento inicial en Firestore: metadatos/contadores_facturas'
            );
          }

          const snapsComandas = await Promise.all(
            refsComandas.map(ref => transaccion.get(ref))
          );
          const comandasFrescas = snapsComandas
            .filter(s => s.exists())
            .map(s => s.data() as Comanda);

          if (comandasFrescas.length === 0) {
            throw new Error('Las comandas de la mesa ya no existen en Firestore.');
          }

          // ─── 2. CÁLCULOS basados en datos FRESCOS ───────────────────────
          // El total y el snapshot de productos derivan exclusivamente del
          // estado autoritativo (Firestore) en el instante de la transacción.
          // Si otra terminal editó una línea entre el clic de cobrar y este
          // punto, Firestore detectará el conflicto y reintentará.
          const totalConIva = comandasFrescas.reduce((suma, c) => suma + (c.precioTotal || 0), 0);
          const productos = comandasFrescas
            .map(c => c.lineasComanda)
            .reduce((acumulado, val) => acumulado.concat(val), []);
          const desglose = calcularDesgloseIva(totalConIva, 10);
          const snapshotProductos = productos.map((p) => ({
            idProducto: p.idProducto,
            nombre: getTranslation(p.nombreProducto, 'es'),
            cantidad: p.cantidad,
            precioUnitario: p.precioUnitario,
            subtotal: p.subtotal
          }));

          const datosContador = docContador.data() as ContadorFacturas;
          const nuevoNumero = datosContador.ultimoNumero + 1;
          const numeroFormateado = `${datosContador.serieActual}-${nuevoNumero.toString().padStart(6, '0')}`;
          const fechaExpedicion = Date.now();
          const hashAnterior = datosContador.ultimoHash;

          // Hash encadenado SHA-256 computado con el total fresco
          const hashActual = await generarHashFactura(
            numeroFormateado,
            fechaExpedicion,
            totalConIva,
            hashAnterior
          );

          const facturaLegal: FacturaLegal = {
            id: refNuevaFactura.id,
            idMesa,
            numeroFactura: numeroFormateado,
            fechaExpedicion,
            baseImponible: desglose.baseImponible,
            cuotaIva: desglose.cuotaIva,
            porcentajeIva: 10,
            importeTotal: totalConIva,
            metodoPago,
            hashAnterior,
            hashActual,
            productos: snapshotProductos
          };

          // ─── 3. ESCRITURAS (atomic: factura + contador + cierre) ────────
          transaccion.set(refNuevaFactura, facturaLegal);
          transaccion.update(refContador, {
            ultimoNumero: nuevoNumero,
            ultimoHash: hashActual
          });
          for (const refComanda of refsComandas) {
            transaccion.update(refComanda, {
              estado: 'PAGADO',
              fechaActualizacion: serverTimestamp()
            });
          }

          return facturaLegal;
        })
      );

      return facturaGenerada as FacturaLegal;

    } catch (error) {
      console.error(`Error al generar factura para mesa ${idMesa}:`, error);
      throw error;
    }
  }

  /**
   * Valida la integridad de una factura contra su hash anterior.
   *
   * @param factura - FacturaLegal a validar
   * @param hashAnteriorEsperado - Hash del documento anterior en la cadena
   * @returns true si el hashAnterior coincide, false en caso contrario
   *
   * Nota: No valida el hashActual (eso se hace durante generación).
   * Esta función es útil para auditoría o validación de integridad.
   */
  validarIntegridad(factura: FacturaLegal, hashAnteriorEsperado: string): boolean {
    return factura.hashAnterior === hashAnteriorEsperado;
  }
}
