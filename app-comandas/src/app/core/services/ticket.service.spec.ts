import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { TicketService } from './ticket.service';
import { FacturaLegal } from '../models/factura.model';

describe('TicketService - Generación de PDF de Factura/Ticket', () => {
  let servicio: TicketService;
  let translateSpy: jasmine.SpyObj<TranslateService>;

  beforeEach(() => {
    translateSpy = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translateSpy.instant.and.callFake((key: string, interpolations?: any) => {
      if (key === 'TICKET.TICKET_CAJA') return `TICKET DE CAJA - MESA ${interpolations?.mesa || ''}`;
      if (key === 'TICKET.TOTAL_MAYUS') return 'TOTAL:';
      if (key === 'TICKET.GRACIAS') return '¡Gracias por su visita!';
      if (key === 'TICKET.IVA_INCLUIDO') return 'IVA INCLUIDO';
      return key;
    });

    TestBed.configureTestingModule({
      providers: [
        TicketService,
        { provide: TranslateService, useValue: translateSpy }
      ]
    });

    servicio = TestBed.inject(TicketService);
  });

  it('debería crearse correctamente', () => {
    expect(servicio).toBeTruthy();
  });

  it('debería generar el documento jsPDF con Serie / número de factura y hash SHA-256 sin CIF ficticio', async () => {
    const facturaDemo: FacturaLegal = {
      id: 'fac-999',
      idMesa: 'Mesa 3',
      numeroFactura: 'F26-000042',
      fechaExpedicion: 1711200000000,
      baseImponible: 20.00,
      cuotaIva: 2.00,
      porcentajeIva: 10,
      importeTotal: 22.00,
      metodoPago: 'TARJETA',
      hashAnterior: 'hash-previo-abc',
      hashActual: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
      productos: [
        {
          idProducto: 'p-1',
          nombre: 'Tapa de Jamón',
          cantidad: 2,
          precioUnitario: 11.00,
          subtotal: 22.00
        }
      ]
    };

    const doc = await servicio.generarTicketPDF(facturaDemo);
    expect(doc).toBeDefined();

    // Comprobamos el texto generado en el PDF
    const textoCompleto = doc.output();

    // 1. Debe incluir número y serie de factura
    expect(textoCompleto).toContain('F26-000042');
    expect(textoCompleto).toContain('Serie /');

    // 2. NO debe incluir el CIF ficticio B12345678
    expect(textoCompleto).not.toContain('B12345678');

    // 3. Debe incluir el hash de integridad SHA-256
    expect(textoCompleto).toContain('Hash de integridad SHA-256');
    expect(textoCompleto).toContain('a1b2c3d4e5f67890');
  });
});
