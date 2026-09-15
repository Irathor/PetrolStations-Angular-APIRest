import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";

import { PriceHistoryResponse } from "../interfaces/priceHistory";

@Injectable({
    providedIn: 'root'
})
export class PriceHistoryApiClient {

    private readonly baseUrl = '/api/oil-stations';

    constructor(private readonly http: HttpClient) { }

    getPriceHistory(stationId: string): Observable<PriceHistoryResponse> {
        return this.http.get<PriceHistoryResponse>(`${this.baseUrl}/${stationId}/price-history`);
    }

}
