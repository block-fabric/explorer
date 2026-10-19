import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * /anchor/:ticket on a chain of stake: what a Chains block committed to is an anchor ticket, not a block. This finds the
 * block of stake that acknowledged it and opens it.
 */
@Component({
  selector: 'app-anchor-redirect',
  standalone: true,
  imports: [CommonModule, RouterModule],
  providers: [RelativeUrlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container-xl" style="padding: 40px 0">
      <h2>Anchor ticket</h2>
      <p class="mono" style="font-family: monospace">{{ ticket }}</p>
      <p *ngIf="!missing">Finding the block that acknowledged it…</p>
      <p *ngIf="missing" class="text-muted">No block has acknowledged this ticket yet (a Chains block committed to it; a block of stake
        acknowledges it a few slots later), or it was outbid by another ticket in the same Chains block.</p>
    </div>`,
})
export class AnchorRedirectPage implements OnInit {
  ticket = '';
  missing = false;

  constructor(private route: ActivatedRoute, private router: Router, private api: ChainApiService, private relativeUrl: RelativeUrlPipe) {}

  ngOnInit(): void {
    this.ticket = this.route.snapshot.paramMap.get('ticket') ?? '';
    this.api.feature$<any>('anchor/' + this.ticket).pipe(catchError(() => of(null))).subscribe((a) => {
      if (a?.block) {
        void this.router.navigate([this.relativeUrl.transform('/block'), a.block], { replaceUrl: true });
      } else {
        this.missing = true;
      }
    });
  }
}
