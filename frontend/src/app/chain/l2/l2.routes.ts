import { Routes } from '@angular/router';
import { L2_FEATURE_PAGES } from '@app/chain/l2/l2-nav';
import { MODULE } from '@app/chain/profiles';

/**
 * The routes of a sidechain explorer (PROFILE.kind 'l2'): app-routing.module.ts loads these in place of upstream's
 * whole route tree, so none of upstream's pages (and none of their API calls) can be reached. Every page is lazy.
 */
const featureList = () => import('@app/chain/l2/pages/feature.page').then(m => m.L2FeaturePageComponent);
const featureItem = () => import('@app/chain/l2/pages/feature.page').then(m => m.L2FeatureItemPage);

export const L2_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('@app/chain/l2/l2-shell.component').then(m => m.L2ShellComponent),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('@app/chain/l2/pages/dashboard.page').then(m => m.L2DashboardPage) },
      { path: 'blocks', loadComponent: () => import('@app/chain/l2/pages/blocks.page').then(m => m.L2BlocksPage) },
      { path: 'block/:id', loadComponent: () => import('@app/chain/l2/pages/block.page').then(m => m.L2BlockPage) },
      { path: 'tx/:txid', loadComponent: () => import('@app/chain/l2/pages/tx.page').then(m => m.L2TxPage) },
      { path: 'address/:address', loadComponent: () => import('@app/chain/l2/pages/address.page').then(m => m.L2AddressPage) },
      { path: 'deposits', data: { peg: 'deposits' }, loadComponent: () => import('@app/chain/l2/pages/bmm.page').then(m => m.L2BmmPage) },
      { path: 'withdrawals', data: { peg: 'withdrawals' }, loadComponent: () => import('@app/chain/l2/pages/bmm.page').then(m => m.L2BmmPage) },
      // BMM and the peg on eCash, from the eCash explorer's drivechain index (GET /api/v1/l2/bmm/*)
      { path: 'bmm', loadComponent: () => import('@app/chain/l2/pages/bmm.page').then(m => m.L2BmmPage) },
      // the chain's own feature pages (its module's routes, chain/modules/<chain>/), ahead of the generic ones they replace
      ...(MODULE.routes ?? []),
      // the feature pages: each chain's header shows those its backend serves (GET /api/v1/chain features)
      ...L2_FEATURE_PAGES.flatMap(p => [
        { path: p.path, data: { page: p.path }, loadComponent: featureList },
        ...(p.detail ? [{ path: p.path + '/:id', data: { page: p.path }, loadComponent: featureItem }] : []),
      ]),
      { path: '**', redirectTo: '' },
    ],
  },
];
