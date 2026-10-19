import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Chains Explorer under a sub-path (e.g. https://explorer.chains.blockfab.org/layers/): the page's <base href>
 * ("/layers/") gives the prefix, '' when the explorer is at the root of its host (the default build, <base href="/">).
 * The Angular router follows <base href> by itself; the backend's API and WebSocket are absolute paths
 * (/api/v1/...), so they get the prefix here.
 */
export function basePath(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const href = document.querySelector('base')?.getAttribute('href') || '/';
  const path = href.startsWith('http') ? new URL(href).pathname : href;
  return path.replace(/\/+$/, '');
}

@Injectable()
export class BasePathInterceptor implements HttpInterceptor {
  private prefix = basePath();

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (this.prefix && (request.url.startsWith('/api/') || request.url === '/api')) {
      return next.handle(request.clone({ url: this.prefix + request.url }));
    }
    return next.handle(request);
  }
}
