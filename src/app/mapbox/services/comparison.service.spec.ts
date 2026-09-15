import { TestBed } from '@angular/core/testing';
import { ComparisonService, MAX_COMPARISON_STATIONS } from './comparison.service';

describe('ComparisonService', () => {
  let service: ComparisonService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ComparisonService);
  });

  it('no tiene ninguna estación seleccionada por defecto', () => {
    expect(service.isSelected('123')).toBe(false);
    expect(service.getAll()).toEqual([]);
  });

  it('toggle añade y quita de la selección', () => {
    expect(service.toggle('123')).toBe(true);
    expect(service.isSelected('123')).toBe(true);

    expect(service.toggle('123')).toBe(true);
    expect(service.isSelected('123')).toBe(false);
  });

  it('no permite superar el máximo de estaciones seleccionadas', () => {
    for(let i = 0; i < MAX_COMPARISON_STATIONS; i++){
      expect(service.toggle(`station-${ i }`)).toBe(true);
    }

    expect(service.getAll().length).toBe(MAX_COMPARISON_STATIONS);
    expect(service.toggle('one-more')).toBe(false);
    expect(service.isSelected('one-more')).toBe(false);
  });

  it('no persiste entre instancias (estado efímero, no localStorage)', () => {
    service.toggle('abc');

    const secondInstance = new ComparisonService();
    expect(secondInstance.isSelected('abc')).toBe(false);
  });

  it('clear vacía la selección y emite un cambio', () => {
    service.toggle('a');
    service.toggle('b');

    let emitted = false;
    service.changes$.subscribe(() => emitted = true);

    service.clear();

    expect(service.getAll()).toEqual([]);
    expect(emitted).toBe(true);
  });
});
