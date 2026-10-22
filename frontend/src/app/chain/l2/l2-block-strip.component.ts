import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { PROFILE } from '@app/chain/profiles';
import { L2BlockSummary } from '@app/chain/l2/l2.interfaces';

/**
 * The newest blocks of a sidechain as a strip of cubes (after upstream's blockchain-blocks and the old block marks),
 * newest on the left: height, transactions, age, and the BMM mark: the eCash block that carried it and the bid paid
 * to its miner. Fed by the page's GET l2/blocks; no upstream state service.
 */
@Component({
  selector: 'app-l2-block-strip',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" [style.--accent]="profile.color">
      @for (b of blocks; track b.hash) {
        <a class="cube-wrap" [routerLink]="['/block', b.hash]" [title]="title(b)">
          <div class="cube" [class.empty]="!b.txCount && !b.deposits">
            <div class="h">{{ b.height | number }}</div>
            <div class="txs">{{ b.txCount | number }} tx{{ b.txCount === 1 ? '' : 's' }}</div>
            @if (b.deposits) {<div class="dep">↓ {{ b.deposits }} deposit{{ b.deposits === 1 ? '' : 's' }}</div>}
            <div class="age">@if (b.time) {<app-time kind="since" [time]="b.time" [fastRender]="true"></app-time>} @else {time unknown}</div>
          </div>
          <div class="bmm-mark">
            @if (b.bmm; as m) {
              <span class="bmm" [class.contested]="m.contested">
                <app-svg-images name="chain-mark" fill="ecash" width="12" height="12"></app-svg-images> {{ m.mainHeight | number }}
              </span>
              <span class="bid">@if (m.bid !== null) { {{ m.bid | number }} sats} @else {no bid}</span>
            } @else if (b.mainBlock; as mb) {
              <span class="bmm"><app-svg-images name="chain-mark" fill="ecash" width="12" height="12"></app-svg-images> {{ mb.height | number }}</span>
            } @else {
              <span class="none">not merged mined yet</span>
            }
          </div>
        </a>
      }
    </div>`,
  styles: [`
    :host { display: block; }
    .strip { display: flex; gap: 22px; overflow-x: auto; padding: 24px 4px 8px 22px; margin-top: 8px; }
    .cube-wrap { flex: 0 0 auto; text-decoration: none; color: var(--fg); display: flex; flex-direction: column; align-items: center; }
    .cube {
      --size: 112px; position: relative; width: var(--size); height: var(--size); padding: 8px 6px;
      display: flex; flex-direction: column; align-items: center; justify-content: space-between; text-align: center;
      background: linear-gradient(color-mix(in srgb, var(--accent) 55%, #1d1f31), color-mix(in srgb, var(--accent) 25%, #1d1f31));
    }
    .cube.empty { background: linear-gradient(#3a3f5a, #2d3348); }
    .cube::after { content: ''; position: absolute; width: var(--size); height: calc(0.192 * var(--size)); top: calc(-0.192 * var(--size));
      left: calc(-0.16 * var(--size)); background: #232838; transform: skew(40deg); transform-origin: top; }
    .cube::before { content: ''; position: absolute; width: calc(0.16 * var(--size)); height: var(--size); top: calc(-0.096 * var(--size));
      left: calc(-0.16 * var(--size)); background: #191c27; transform: skewY(50deg); transform-origin: top; }
    .cube-wrap:hover .cube { filter: brightness(1.15); }
    .h { font-weight: 700; font-size: 1.05rem; }
    .txs { font-size: 0.82rem; }
    .dep { font-size: 0.72rem; color: #3bd16f; font-weight: 600; }
    .age { font-size: 0.72rem; opacity: 0.8; }
    .bmm-mark { margin-top: 6px; display: flex; flex-direction: column; align-items: center; font-size: 0.72rem; line-height: 1.25; }
    .bmm { display: inline-flex; align-items: center; gap: 3px; color: #b5f27e; font-weight: 600; }
    .bmm.contested { color: #ffd166; }
    .bid { color: var(--transparent-fg); }
    .none { color: var(--transparent-fg); }
  `],
})
export class L2BlockStripComponent {
  @Input() blocks: L2BlockSummary[] = [];
  profile = PROFILE;

  title(b: L2BlockSummary): string {
    const m = b.bmm;
    if (m) {
      return `Block ${b.height}: carried by eCash block ${m.mainHeight}` + (m.bid !== null ? `, bid ${m.bid} sats` : '')
        + (m.contested ? `, ${m.requests} requests for the slot in that eCash block` : '');
    }
    return b.mainBlock ? `Block ${b.height}: carried by eCash block ${b.mainBlock.height}` : `Block ${b.height}: no eCash block carried it yet`;
  }
}
