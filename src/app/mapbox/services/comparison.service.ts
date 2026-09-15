import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Máximo de gasolineras que se pueden tener seleccionadas a la vez para comparar. */
export const MAX_COMPARISON_STATIONS = 4;

/**
 * Gasolineras seleccionadas para comparar. A diferencia de FavoritesService,
 * es estado de trabajo puramente efímero (una comparación en curso, no una
 * preferencia del usuario): vive solo en memoria, se pierde al recargar la
 * página a propósito, no se persiste en localStorage.
 */
@Injectable({
  providedIn: 'root'
})
export class ComparisonService {

  private readonly selectedIds = new Set<string>();

  private readonly changes = new Subject<void>();
  /** Emite cada vez que cambia la selección (añadir/quitar/vaciar), para que la UI (badge, tabla) se mantenga al día. */
  readonly changes$: Observable<void> = this.changes.asObservable();

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  /**
   * Alterna la selección de una gasolinera. Devuelve false sin hacer nada si
   * se intenta añadir una nueva por encima de MAX_COMPARISON_STATIONS (quitar
   * una ya seleccionada siempre funciona). El llamante puede usar el valor de
   * retorno para dar feedback ("máximo 4 estaciones") sin tener que volver a
   * consultar isSelected() por separado.
   */
  toggle(id: string): boolean {
    if(this.selectedIds.has(id)){
      this.selectedIds.delete(id);
      this.changes.next();
      return true;
    }

    if(this.selectedIds.size >= MAX_COMPARISON_STATIONS){
      return false;
    }

    this.selectedIds.add(id);
    this.changes.next();
    return true;
  }

  remove(id: string){
    if(this.selectedIds.delete(id)){
      this.changes.next();
    }
  }

  clear(){
    if(this.selectedIds.size > 0){
      this.selectedIds.clear();
      this.changes.next();
    }
  }

  getAll(): string[] {
    return [...this.selectedIds];
  }

  get count(): number {
    return this.selectedIds.size;
  }

}
