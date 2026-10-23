import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { NavItem } from '@app/chain/chain-module';
import { MODULE } from '@app/chain/profiles';

/**
 * A module's nav entries as the header and footer show them: all of them at once, then without those whose
 * MODULE.navIf check says no (an empty list: FreeBank's gold, pools, assets) or fails.
 */
export function moduleNav$(api: ChainApiService, items: NavItem[]): Observable<NavItem[]> {
  const checks = MODULE.navIf ?? {};
  const conditional = items.filter(n => checks[n.path]);
  if (!conditional.length) {
    return of(items);
  }
  const get = <T>(path: string) => api.get<T>(path);
  return combineLatest(conditional.map(n => checks[n.path](get).pipe(catchError(() => of(false))))).pipe(
    map(oks => {
      const hidden = new Set(conditional.filter((_, i) => !oks[i]).map(n => n.path));
      return items.filter(n => !hidden.has(n.path));
    }),
  );
}
