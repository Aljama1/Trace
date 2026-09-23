import { calcularDesgloseIva, generarHashFactura } from './factura.model';

describe('FacturaModel - IVA y Hash SHA-256', () => {
  describe('calcularDesgloseIva', () => {
    it('debería calcular correctamente el IVA del 10% para importes redondos', () => {
      // 11.00 € con 10% IVA -> Base = 11 / 1.10 = 10.00 €, Cuota = 1.00 €
      const resultado = calcularDesgloseIva(11.00, 10);
      expect(resultado.baseImponible).toBe(10.00);
      expect(resultado.cuotaIva).toBe(1.00);
      expect(Number((resultado.baseImponible + resultado.cuotaIva).toFixed(2))).toBe(11.00);
    });

    it('debería calcular correctamente el IVA del 10% con decimales y mantener la suma exacta', () => {
      // 50.00 € con 10% IVA -> Base = 50 / 1.10 = 45.45 €, Cuota = 50 - 45.45 = 4.55 €
      const resultado50 = calcularDesgloseIva(50.00, 10);
      expect(resultado50.baseImponible).toBe(45.45);
      expect(resultado50.cuotaIva).toBe(4.55);
      expect(Number((resultado50.baseImponible + resultado50.cuotaIva).toFixed(2))).toBe(50.00);

      // 15.30 € con 10% IVA -> Base = 15.30 / 1.10 = 13.91 €, Cuota = 1.39 €
      const resultado15 = calcularDesgloseIva(15.30, 10);
      expect(resultado15.baseImponible).toBe(13.91);
      expect(resultado15.cuotaIva).toBe(1.39);
      expect(Number((resultado15.baseImponible + resultado15.cuotaIva).toFixed(2))).toBe(15.30);
    });

    it('debería manejar importe 0 correctamente', () => {
      const resultado = calcularDesgloseIva(0, 10);
      expect(resultado.baseImponible).toBe(0);
      expect(resultado.cuotaIva).toBe(0);
    });

    it('debería respetar porcentaje personalizado de IVA (ej. 21%)', () => {
      // 121.00 € con 21% -> Base = 100.00 €, Cuota = 21.00 €
      const resultado21 = calcularDesgloseIva(121.00, 21);
      expect(resultado21.baseImponible).toBe(100.00);
      expect(resultado21.cuotaIva).toBe(21.00);
      expect(Number((resultado21.baseImponible + resultado21.cuotaIva).toFixed(2))).toBe(121.00);
    });
  });

  describe('generarHashFactura', () => {
    it('debería generar un hash SHA-256 hexadecimal válido de 64 caracteres', async () => {
      const hash = await generarHashFactura('F26-000001', 1711200000000, 25.50, 'GENESIS');
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBeTrue();
    });

    it('debería ser determinista para los mismos parámetros', async () => {
      const hash1 = await generarHashFactura('F26-000001', 1711200000000, 25.50, 'GENESIS');
      const hash2 = await generarHashFactura('F26-000001', 1711200000000, 25.50, 'GENESIS');
      expect(hash1).toBe(hash2);
    });

    it('debería cambiar el hash si varía cualquier dato crítico (inalterabilidad)', async () => {
      const hashBase = await generarHashFactura('F26-000001', 1711200000000, 25.50, 'GENESIS');
      
      const hashTotalDiferente = await generarHashFactura('F26-000001', 1711200000000, 25.51, 'GENESIS');
      expect(hashTotalDiferente).not.toBe(hashBase);

      const hashAnteriorDiferente = await generarHashFactura('F26-000001', 1711200000000, 25.50, 'OTRO_HASH');
      expect(hashAnteriorDiferente).not.toBe(hashBase);

      const hashNumeroDiferente = await generarHashFactura('F26-000002', 1711200000000, 25.50, 'GENESIS');
      expect(hashNumeroDiferente).not.toBe(hashBase);
    });
  });
});
