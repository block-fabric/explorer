import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MODULE, NODE_SIDECHAIN, PROFILE } from '@app/chain/profiles';
import { ChainViewName } from '@app/chain/chain-module';

/**
 * The sidechain views of upstream's pages (CHAIN_UI 'full'), loaded on demand: the block page's BMM panel, the
 * transaction page's content panel, the address page's holdings, the dashboard's widgets. Upstream's templates (and
 * the chain/ components SharedModule declares) place them through this host, which imports nothing of chain/l2 up
 * front: the views import SharedModule themselves, and stay out of the eCash explorer's bundles. On the eCash explorer
 * (PROFILE.kind 'l1') it shows nothing; on a node sidechain's (Flush, FreeBank: profiles.ts NODE_SIDECHAIN) its module's
 * views (MODULE.views: chain/modules/<id>/views).
 */
const VIEWS: Record<string, () => Promise<Type<any>>> = {
  block: () => import('@app/chain/l2/full/l2-block-panel.component').then(m => m.L2BlockPanelComponent),
  tx: () => import('@app/chain/l2/full/l2-tx-panel.component').then(m => m.L2TxPanelComponent),
  address: () => import('@app/chain/l2/full/l2-address-panel.component').then(m => m.L2AddressPanelComponent),
  widget: () => import('@app/chain/l2/full/l2-widget.component').then(m => m.L2WidgetComponent),
};

export type L2ViewName = ChainViewName;

@Component({
  selector: 'app-l2-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (component) {<ng-container *ngComponentOutlet="component; inputs: inputs"></ng-container>}`,
})
export class L2ViewComponent implements OnChanges {
  @Input() view: L2ViewName;
  @Input() inputs: Record<string, unknown> = {};
  component: Type<any> | null = null;
  private loaded: string | null = null;

  constructor(private cd: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    const views: Partial<Record<string, () => Promise<Type<any>>>> = NODE_SIDECHAIN ? (MODULE.views ?? {}) : VIEWS;
    if (PROFILE.kind === 'l1' || !changes.view || this.loaded === this.view || !views[this.view]) {
      return;
    }
    const view = this.loaded = this.view;
    views[view]().then((c) => {
      if (this.loaded === view) {
        this.component = c;
        this.cd.markForCheck();
      }
    }).catch(() => { this.loaded = null; });
  }
}
