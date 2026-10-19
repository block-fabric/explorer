import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { describeActivity } from './activity-text';

/** The token ledger's operations (GET sidechain/activity, asset/:id/activity, ...) in plain words with their amounts */
@Component({
  selector: 'app-bitassets-activity',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    table { margin: 0; font-size: 0.85rem; } td { vertical-align: middle; }
    .k { font-size: 0.72rem; font-weight: 700; padding: 1px 7px; border-radius: 10px; white-space: nowrap;
      background: color-mix(in srgb, var(--chain-accent, #8f7cff) 22%, transparent); }
    .k.swap, .k.route { background: color-mix(in srgb, #b5f27e 25%, transparent); }
    .k.burn { background: color-mix(in srgb, #ff6b6b 25%, transparent); }
    .muted { color: var(--transparent-fg); } .mono { font-family: monospace; font-size: 0.8rem; }
    .what b { font-weight: 600; }
  `],
  template: `
    <p *ngIf="!events?.length" class="muted mb-0">No operation yet.</p>
    <table class="table table-borderless table-sm" *ngIf="events?.length">
      <tbody>
        <tr *ngFor="let e of events">
          <td><a [routerLink]="['/block' | relativeUrl, e.h]">{{ e.h | number }}</a></td>
          <td class="muted"><app-time kind="since" [time]="e.t" [fastRender]="true"></app-time></td>
          <td><span class="k" [class]="e.kind">{{ e.kind.replace('-', ' ') }}</span></td>
          <td class="what" [innerHTML]="describe(e)"></td>
          <td class="mono text-right"><a [routerLink]="['/tx' | relativeUrl, e.tx]">{{ e.tx | slice:0:10 }}…</a></td>
        </tr>
      </tbody>
    </table>
  `,
})
export class ActivityTableComponent {
  @Input() events: any[] = [];

  describe = describeActivity;
}
