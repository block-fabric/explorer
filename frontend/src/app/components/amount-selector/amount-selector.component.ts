import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { StorageService } from '@app/services/storage.service';
import { StateService } from '@app/services/state.service';

import { PROFILE } from '@app/chain/profiles';

/** the storage key of a sidechain explorer's amount mode ('sats' or 'btc', i.e. ECX) */
export const L2_AMOUNT_MODE_KEY = 'l2-view-amount-mode';
@Component({
  selector: 'app-amount-selector',
  templateUrl: './amount-selector.component.html',
  styleUrls: ['./amount-selector.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AmountSelectorComponent implements OnInit {
  // eCash Explorer: a sidechain explorer counts in sats, and shows its amounts in ECX (1e8 sats) as the 'btc' mode;
  // it keeps its choice under its own key (sats by default), apart from the eCash explorer's
  unit = PROFILE.kind === 'l2' ? 'ECX' : PROFILE.unit;
  showFiat = PROFILE.kind !== 'l2';
  amountForm: UntypedFormGroup;
  modes = ['btc', 'sats', 'fiat'];

  constructor(
    private formBuilder: UntypedFormBuilder,
    private stateService: StateService,
    private storageService: StorageService,
  ) { }

  ngOnInit() {
    this.amountForm = this.formBuilder.group({
      mode: ['btc']
    });
    this.stateService.viewAmountMode$.subscribe((mode) => {
      this.amountForm.get('mode')?.setValue(mode);
    });
  }

  changeMode() {
    const newMode = this.amountForm.get('mode')?.value;
    this.storageService.setValue(PROFILE.kind === 'l2' ? L2_AMOUNT_MODE_KEY : 'view-amount-mode', newMode);
    this.stateService.viewAmountMode$.next(newMode);
  }
}
