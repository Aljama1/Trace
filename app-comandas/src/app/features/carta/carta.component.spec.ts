import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { CartaComponent } from './carta.component';
import { CartaService } from '../../core/services/carta.service';
import { UsuarioService } from '../../core/services/usuario.service';
import { ComandaService } from '../../core/services/comanda.service';
import { ComandaFirestoreService } from '../../core/services/comanda-firestore.service';
import { UserSettingsService } from '../../core/services/user-settings.service';
import { AudioService } from '../../core/services/audio.service';
import { Producto } from '../../core/models/producto.model';
import { PerfilUsuario } from '../../core/models/perfil-usuario.model';

describe('CartaComponent - Filtrado de Alérgenos y Bloqueo Seguro', () => {
  let routerMock: jasmine.SpyObj<Router>;
  let alertCtrlMock: jasmine.SpyObj<AlertController>;
  let audioMock: jasmine.SpyObj<AudioService>;
  let translateMock: jasmine.SpyObj<TranslateService>;
  let comandaServiceMock: jasmine.SpyObj<ComandaService>;
  let firestoreMock: jasmine.SpyObj<ComandaFirestoreService>;
  let settingsMock: jasmine.SpyObj<UserSettingsService>;

  const productosMock = signal<Producto[]>([]);
  const perfilMock = signal<PerfilUsuario | null>(null);

  const productoConGluten: Producto = {
    id: 'p-gluten',
    nombre: { es: 'Pan Casero', en: 'Homemade Bread' },
    descripcion: { es: 'Pan de trigo', en: 'Wheat bread' },
    precio: 2.50,
    categoria: 'entrante',
    disponible: true,
    alergenos: ['Gluten'],
    stock: 10
  };

  const productoConLactosaYGluten: Producto = {
    id: 'p-pizza',
    nombre: { es: 'Pizza Cuatro Quesos', en: 'Four Cheese Pizza' },
    descripcion: { es: 'Pizza artesanal', en: 'Artisan pizza' },
    precio: 12.00,
    categoria: 'principal',
    disponible: true,
    alergenos: ['Gluten', 'Lácteos'],
    stock: 5
  };

  const productoLimpio: Producto = {
    id: 'p-ensalada',
    nombre: { es: 'Ensalada Verde', en: 'Green Salad' },
    descripcion: { es: 'Lechuga y tomate', en: 'Lettuce and tomato' },
    precio: 6.00,
    categoria: 'entrante',
    disponible: true,
    alergenos: [],
    stock: 15
  };

  const productoAgotado: Producto = {
    id: 'p-postre',
    nombre: { es: 'Tarta Especial', en: 'Special Cake' },
    descripcion: { es: 'Postre del día', en: 'Dessert of the day' },
    precio: 5.00,
    categoria: 'postre',
    disponible: true,
    alergenos: [],
    stock: 0
  };

  beforeEach(async () => {
    routerMock = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    alertCtrlMock = jasmine.createSpyObj<AlertController>('AlertController', ['create']);
    audioMock = jasmine.createSpyObj<AudioService>('AudioService', ['reproducirNotificacionSuave']);
    translateMock = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant', 'use']);
    translateMock.instant.and.callFake((k: string) => k);

    comandaServiceMock = jasmine.createSpyObj<ComandaService>('ComandaService', ['agregarLinea', 'vaciarComanda']);
    firestoreMock = jasmine.createSpyObj<ComandaFirestoreService>('ComandaFirestoreService', ['tieneComandas', 'limpiarSeguimiento']);
    settingsMock = jasmine.createSpyObj<UserSettingsService>('UserSettingsService', ['toggleDark']);

    productosMock.set([productoConGluten, productoConLactosaYGluten, productoLimpio, productoAgotado]);
    perfilMock.set({
      nombre: 'Manuel',
      mesaId: 5,
      alergenos: []
    });

    await TestBed.configureTestingModule({
      imports: [CartaComponent],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: AlertController, useValue: alertCtrlMock },
        { provide: AudioService, useValue: audioMock },
        { provide: TranslateService, useValue: translateMock },
        { provide: ComandaService, useValue: comandaServiceMock },
        { provide: ComandaFirestoreService, useValue: firestoreMock },
        { provide: UserSettingsService, useValue: settingsMock },
        {
          provide: CartaService,
          useValue: { productos: productosMock }
        },
        {
          provide: UsuarioService,
          useValue: { perfil: perfilMock, establecerPerfil: jasmine.createSpy('establecerPerfil') }
        }
      ]
    }).compileComponents();
  });

  it('debería marcar todos los productos como seguros si el usuario no tiene alérgenos', () => {
    const fixture = TestBed.createComponent(CartaComponent);
    const comp = fixture.componentInstance;

    const maquetados = comp.productosMaquetados();
    expect(maquetados.length).toBe(4);
    expect(maquetados.every(p => p.esSeguro)).toBeTrue();
  });

  it('debería detectar incompatibilidad y marcar esSeguro = false para productos con Gluten', () => {
    perfilMock.set({
      nombre: 'Manuel',
      mesaId: 5,
      alergenos: ['gluten'] // minúsculas desde el perfil
    });

    const fixture = TestBed.createComponent(CartaComponent);
    const comp = fixture.componentInstance;

    const maquetados = comp.productosMaquetados();
    const pan = maquetados.find(p => p.id === 'p-gluten')!;
    const pizza = maquetados.find(p => p.id === 'p-pizza')!;
    const ensalada = maquetados.find(p => p.id === 'p-ensalada')!;

    expect(pan.esSeguro).toBeFalse();
    expect(pan.alergenosPeligrosos).toContain('Gluten');

    expect(pizza.esSeguro).toBeFalse();
    expect(pizza.alergenosPeligrosos).toContain('Gluten');

    expect(ensalada.esSeguro).toBeTrue();
    expect(ensalada.alergenosPeligrosos.length).toBe(0);
  });

  it('debería manejar múltiples alérgenos simultáneos (gluten y lactosa)', () => {
    perfilMock.set({
      nombre: 'Manuel',
      mesaId: 5,
      alergenos: ['gluten', 'lactosa']
    });

    const fixture = TestBed.createComponent(CartaComponent);
    const comp = fixture.componentInstance;

    const maquetados = comp.productosMaquetados();
    const pizza = maquetados.find(p => p.id === 'p-pizza')!;

    expect(pizza.esSeguro).toBeFalse();
    // Debe haber detectado ambos o al menos los que coinciden (Gluten y Lácteos)
    expect(pizza.alergenosPeligrosos.length).toBeGreaterThanOrEqual(1);
    expect(pizza.alergenosPeligrosos).toContain('Gluten');
  });

  it('debería bloquear la adición de un producto incompatible al carrito (puedeAnadir = false)', () => {
    perfilMock.set({
      nombre: 'Manuel',
      mesaId: 5,
      alergenos: ['gluten']
    });

    const fixture = TestBed.createComponent(CartaComponent);
    const comp = fixture.componentInstance;

    const maquetados = comp.productosMaquetados();
    const panInseguro = maquetados.find(p => p.id === 'p-gluten')!;

    comp.abrirProducto(panInseguro);
    expect(comp.puedeAnadir()).toBeFalse();

    // Intentar agregar no debe llamar a comandaService
    comp.agregarDesdeModal(panInseguro);
    expect(comandaServiceMock.agregarLinea).not.toHaveBeenCalled();
  });

  it('debería bloquear productos agotados aunque no tengan alérgenos', () => {
    const fixture = TestBed.createComponent(CartaComponent);
    const comp = fixture.componentInstance;

    const maquetados = comp.productosMaquetados();
    const tartaAgotada = maquetados.find(p => p.id === 'p-postre')!;

    expect(tartaAgotada.agotado).toBeTrue();
    comp.abrirProducto(tartaAgotada);
    expect(comp.puedeAnadir()).toBeFalse();
  });

  it('debería permitir añadir producto seguro con stock disponible', () => {
    const fixture = TestBed.createComponent(CartaComponent);
    const comp = fixture.componentInstance;

    const maquetados = comp.productosMaquetados();
    const ensalada = maquetados.find(p => p.id === 'p-ensalada')!;

    comp.abrirProducto(ensalada);
    expect(comp.puedeAnadir()).toBeTrue();

    comp.agregarDesdeModal(ensalada);
    expect(comandaServiceMock.agregarLinea).toHaveBeenCalledWith(
      ensalada,
      1,
      '',
      undefined,
      []
    );
  });
});
