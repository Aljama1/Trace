import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FacturaLegal } from '../models/factura.model';

@Injectable({
  providedIn: 'root'
})
export class TicketService {
  private translate = inject(TranslateService);

  constructor() { }

  /**
   * Genera un PDF profesional con el formato de ticket de restaurante.
   */
  async generarTicketPDF(data: FacturaLegal): Promise<jsPDF> {
    const doc = new jsPDF({
      unit: 'mm',
      format: [80, 150] // Formato típico de impresora térmica (80mm de ancho)
    });

    const margin = 5;
    const width = 80;
    let y = 10;

    // --- HEADER ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('TRACE.', width / 2, y, { align: 'center' });
    
    y += 6;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Trace · Demo Hostelería', width / 2, y, { align: 'center' });
    
    y += 4;
    doc.text('Demostración técnica (sin validez fiscal)', width / 2, y, { align: 'center' });
    
    y += 8;
    doc.line(margin, y, width - margin, y);
    
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text(this.translate.instant('TICKET.TICKET_CAJA', { mesa: data.idMesa.replace('Mesa ', '') }), margin, y);
    
    y += 5;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Serie / número de factura: ${data.numeroFactura}`, margin, y);
    
    y += 5;
    const lang = this.translate.currentLang === 'en' ? 'en-US' : 'es-ES';
    const fechaStr = new Date(data.fechaExpedicion).toLocaleString(lang);
    doc.text(`${this.translate.instant('TICKET.FECHA')}: ${fechaStr}`, margin, y);
    doc.text(`${this.translate.instant('TICKET.PAGO')}: ${data.metodoPago}`, width - margin, y, { align: 'right' });

    y += 5;
    
    // --- TABLA DE PRODUCTOS ---
    const tableData = data.productos.map(p => [
      p.cantidad.toString(),
      p.nombre.substring(0, 20),
      `${p.precioUnitario.toFixed(2)}€`,
      `${p.subtotal.toFixed(2)}€`
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [[
        this.translate.instant('TICKET.CANT'),
        this.translate.instant('TICKET.CONCEPTO'),
        this.translate.instant('TICKET.PU'),
        this.translate.instant('TICKET.TOTAL')
      ]],
      body: tableData,
      theme: 'plain',
      styles: { fontSize: 7, cellPadding: 1 },
      headStyles: { fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 15, halign: 'right' },
        3: { cellWidth: 15, halign: 'right' }
      }
    });

    // @ts-ignore
    y = doc.lastAutoTable.finalY + 10;

    // --- FOOTER / TOTAL ---
    doc.line(margin, y - 5, width - margin, y - 5);
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`${this.translate.instant('TICKET.BASE_IMPONIBLE')}:`, margin, y);
    doc.text(`${data.baseImponible.toFixed(2)}€`, width - margin, y, { align: 'right' });
    
    y += 5;
    doc.text(`${this.translate.instant('TICKET.IVA')} (${data.porcentajeIva}%):`, margin, y);
    doc.text(`${data.cuotaIva.toFixed(2)}€`, width - margin, y, { align: 'right' });

    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(this.translate.instant('TICKET.TOTAL_MAYUS'), margin, y);
    doc.text(`${data.importeTotal.toFixed(2)}€`, width - margin, y, { align: 'right' });

    y += 8;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(this.translate.instant('TICKET.GRACIAS'), width / 2, y, { align: 'center' });
    
    y += 4;
    doc.text(this.translate.instant('TICKET.IVA_INCLUIDO'), width / 2, y, { align: 'center' });

    if (data.hashActual) {
      y += 6;
      doc.line(margin, y - 2, width - margin, y - 2);
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      doc.text('Hash de integridad SHA-256:', width / 2, y + 1.5, { align: 'center' });
      y += 5;
      doc.setFont('courier', 'normal');
      doc.setFontSize(5);
      const hashLines = doc.splitTextToSize(data.hashActual, width - (margin * 2));
      doc.text(hashLines, width / 2, y, { align: 'center' });
    }

    // --- ACCIÓN ---
    // En web lo descargamos o abrimos en pestaña nueva
    if (typeof window !== 'undefined' && window.open) {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
    return doc;
  }
}
