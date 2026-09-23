import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { AdminComandaService } from './admin-comanda.service';
import { AudioService } from './audio.service';
import { ProductoAdminService } from './producto-admin.service';
import { FacturacionService } from './facturacion.service';
import { UserSettingsService } from './user-settings.service';
import { Comanda } from '../models/comanda.model';

describe('AdminComandaService - KDS y Agregación de Comandas', () => {
  let servicio: AdminComandaService;

  beforeEach(() => {
    const audioSpy = jasmine.createSpyObj<AudioService>('AudioService', ['reproducirPing', 'reproducirNotificacionSuave']);
    const productoAdminSpy = jasmine.createSpyObj<ProductoAdminService>('ProductoAdminService', ['descontarStock']);
    const facturacionSpy = jasmine.createSpyObj<FacturacionService>('FacturacionService', ['generarFactura', 'validarIntegridad']);
    const userSettingsSpy = jasmine.createSpyObj<UserSettingsService>('UserSettingsService', ['soundEnabled']);
    userSettingsSpy.soundEnabled.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        AdminComandaService,
        { provide: Firestore, useValue: {} },
        { provide: AudioService, useValue: audioSpy },
        { provide: ProductoAdminService, useValue: productoAdminSpy },
        { provide: FacturacionService, useValue: facturacionSpy },
        { provide: UserSettingsService, useValue: userSettingsSpy },
      ]
    });

    servicio = TestBed.inject(AdminComandaService);
  });

  it('debería crearse correctamente', () => {
    expect(servicio).toBeTruthy();
  });

  describe('Clasificación por estados (computed signals)', () => {
    it('debería clasificar correctamente en pendientes, en curso e historial', () => {
      const comandaPendiente: Comanda = {
        id: 'c-1', idMesa: 'Mesa 1', idCliente: 'cli-1', nombreCliente: 'Ana',
        estado: 'PENDIENTE', precioTotal: 12, lineasComanda: [],
        fechaCreacion: 1000, fechaActualizacion: 1000
      };
      const comandaPreparando: Comanda = {
        id: 'c-2', idMesa: 'Mesa 2', idCliente: 'cli-2', nombreCliente: 'Luis',
        estado: 'PREPARANDO', precioTotal: 25, lineasComanda: [],
        fechaCreacion: 2000, fechaActualizacion: 2000
      };
      const comandaServida: Comanda = {
        id: 'c-3', idMesa: 'Mesa 3', idCliente: 'cli-3', nombreCliente: 'Carlos',
        estado: 'SERVIDO', precioTotal: 30, lineasComanda: [],
        fechaCreacion: 3000, fechaActualizacion: 3000
      };

      (servicio as any)._comandasActivas.set([comandaPendiente, comandaPreparando, comandaServida]);

      expect(servicio.pedidosPendientes().length).toBe(1);
      expect(servicio.pedidosPendientes()[0].id).toBe('c-1');

      expect(servicio.pedidosEnCurso().length).toBe(1);
      expect(servicio.pedidosEnCurso()[0].id).toBe('c-2');

      expect(servicio.pedidosHistorial().length).toBe(1);
      expect(servicio.pedidosHistorial()[0].id).toBe('c-3');
    });
  });

  describe('KDS y Agregación de Raciones (Cocina y Barra)', () => {
    it('debería filtrar y agregar pedidos para Cocina sumando cantidades entre diferentes mesas', () => {
      const comandaMesa1: Comanda = {
        id: 'c-10', idMesa: 'Mesa 1', idCliente: 'cli-1', nombreCliente: 'Cliente 1',
        estado: 'PREPARANDO', precioTotal: 40,
        lineasComanda: [
          {
            idProducto: 'prod-hamburguesa',
            nombreProducto: { es: 'Hamburguesa Clásica', en: 'Classic Burger' },
            cantidad: 2,
            precioUnitario: 10,
            subtotal: 20,
            destino: 'COCINA',
            preparado: false,
            notasEspeciales: 'Muy hecha'
          },
          {
            idProducto: 'prod-cerveza',
            nombreProducto: { es: 'Cerveza Doble', en: 'Double Beer' },
            cantidad: 2,
            precioUnitario: 3.5,
            subtotal: 7,
            destino: 'BARRA',
            preparado: false
          }
        ],
        fechaCreacion: 1000, fechaActualizacion: 1000
      };

      const comandaMesa2: Comanda = {
        id: 'c-20', idMesa: 'Mesa 2', idCliente: 'cli-2', nombreCliente: 'Cliente 2',
        estado: 'PREPARANDO', precioTotal: 20,
        lineasComanda: [
          {
            idProducto: 'prod-hamburguesa',
            nombreProducto: { es: 'Hamburguesa Clásica', en: 'Classic Burger' },
            cantidad: 1,
            precioUnitario: 10,
            subtotal: 10,
            destino: 'COCINA',
            preparado: false
          }
        ],
        fechaCreacion: 1500, fechaActualizacion: 1500
      };

      (servicio as any)._comandasActivas.set([comandaMesa1, comandaMesa2]);

      // Cocina solo ve las líneas de COCINA no preparadas
      const agregadosCocina = servicio.productosAgregadosCocina();
      expect(agregadosCocina.length).toBe(1);
      expect(agregadosCocina[0].nombre).toBe('Hamburguesa Clásica');
      expect(agregadosCocina[0].cantidadTotal).toBe(3); // 2 de mesa 1 + 1 de mesa 2
      expect(agregadosCocina[0].mesas).toEqual(['Mesa 1', 'Mesa 2']);
      expect(agregadosCocina[0].notas.length).toBe(1);
      expect(agregadosCocina[0].notas[0]).toContain('Mesa Mesa 1: Muy hecha');

      // Barra solo ve bebidas
      const agregadosBarra = servicio.productosBarra();
      expect(agregadosBarra.length).toBe(1);
      expect(agregadosBarra[0].nombre).toBe('Cerveza Doble');
      expect(agregadosBarra[0].cantidadTotal).toBe(2);
    });

    it('no debería incluir en el KDS platos que ya están marcados como preparados', () => {
      const comanda: Comanda = {
        id: 'c-30', idMesa: 'Mesa 4', idCliente: 'cli-4', nombreCliente: 'Marta',
        estado: 'PREPARANDO', precioTotal: 15,
        lineasComanda: [
          {
            idProducto: 'prod-ensalada',
            nombreProducto: { es: 'Ensalada César', en: 'Caesar Salad' },
            cantidad: 1,
            precioUnitario: 9,
            subtotal: 9,
            destino: 'COCINA',
            preparado: true // ya listo
          }
        ],
        fechaCreacion: 1000, fechaActualizacion: 1000
      };

      (servicio as any)._comandasActivas.set([comanda]);

      expect(servicio.pedidosCocina().length).toBe(0);
      expect(servicio.productosAgregadosCocina().length).toBe(0);
    });
  });

  describe('Solicitud de cuenta', () => {
    it('debería identificar mesas con solicitaCuenta = true y ordenarlas', () => {
      const comanda1: Comanda = {
        id: 'c-40', idMesa: 'Mesa 10', idCliente: 'cli-1', nombreCliente: 'A',
        estado: 'SERVIDO', precioTotal: 20, lineasComanda: [],
        solicitaCuenta: true, fechaCreacion: 1000, fechaActualizacion: 1000
      };
      const comanda2: Comanda = {
        id: 'c-41', idMesa: 'Mesa 2', idCliente: 'cli-2', nombreCliente: 'B',
        estado: 'SERVIDO', precioTotal: 15, lineasComanda: [],
        solicitaCuenta: true, fechaCreacion: 1000, fechaActualizacion: 1000
      };
      const comanda3: Comanda = {
        id: 'c-42', idMesa: 'Mesa 5', idCliente: 'cli-3', nombreCliente: 'C',
        estado: 'PREPARANDO', precioTotal: 30, lineasComanda: [],
        solicitaCuenta: false, fechaCreacion: 1000, fechaActualizacion: 1000
      };

      (servicio as any)._comandasActivas.set([comanda1, comanda2, comanda3]);

      const mesasCuenta = servicio.mesasConSolicitudCuenta();
      expect(mesasCuenta.length).toBe(2);
      expect(mesasCuenta).toEqual(['Mesa 2', 'Mesa 10']); // orden numérico
    });
  });
});
