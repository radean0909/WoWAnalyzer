import React from 'react';
import { formatPercentage, formatThousands } from 'common/format';
import SCHOOLS from 'common/MAGIC_SCHOOLS';
import SpellIcon from 'common/SpellIcon';
import SpellLink from 'common/SpellLink';
import StatisticBox, { STATISTIC_ORDER } from 'Main/StatisticBox';
import Module from 'Parser/Core/Module';
import Combatants from 'Parser/Core/Modules/Combatants';
import SPELLS from 'common/SPELLS';

const debug = true;
const IRONFUR_BASE_DURATION = 6;
const UE_DURATION_PER_RANK = 0.5;
const GUARDIAN_OF_ELUNE_DURATION = 2;

class IronFur extends Module {
  static dependencies = {
    combatants: Combatants,
  };

  _stacksTimeline = [];
  _hitsPerStackCounter = [];
  ironfurDuration = IRONFUR_BASE_DURATION; // Base duration

  lastIronfurBuffApplied = 0;
  physicalHitsWithIronFur = 0;
  physicalDamageWithIronFur = 0;
  physicalHitsWithoutIronFur = 0;
  physicalDamageWithoutIronFur = 0;

  on_initialized() {
    const ueRank = this.combatants.selected.traitsBySpellId[SPELLS.URSOCS_ENDURANCE.id];
    this.ironfurDuration += (ueRank * UE_DURATION_PER_RANK);
  }

  getMostRecentStackIndex(timestamp) {
    let i = this._stacksTimeline.length - 1;
    while (i >= 0 && this._stacksTimeline[i].timestamp > timestamp) {
      i--;
    }

    return i;
  }

  getStackCount(timestamp) {
    const index = this.getMostRecentStackIndex(timestamp);
    if (index < 0) {
      return 0;
    }

    return this._stacksTimeline[index].stackCount;
  }

  addStack(stackStart, stackEnd) {
    const index = this.getMostRecentStackIndex(stackStart);
    if (index === -1) {
      this._stacksTimeline.push({ timestamp: stackStart, stackCount: 1 });
      this._stacksTimeline.push({ timestamp: stackEnd, stackCount: 0 });
      return;
    }

    const stackCount = this._stacksTimeline[index].stackCount;
    this._stacksTimeline.splice(index + 1, 0, { timestamp: stackStart, stackCount });
    let i = index + 1;
    let finalStackCount = stackCount;
    while (i < this._stacksTimeline.length && this._stacksTimeline[i].timestamp < stackEnd) {
      this._stacksTimeline[i].stackCount += 1;
      finalStackCount = this._stacksTimeline[i].stackCount;
      i += 1;
    }
    this._stacksTimeline.splice(i, 0, { timestamp: stackEnd, stackCount: finalStackCount - 1 });
  }

  registerHit(stackCount) {
    if (!this._hitsPerStackCounter[stackCount]) {
      this._hitsPerStackCounter[stackCount] = 0;
    }

    this._hitsPerStackCounter[stackCount] += 1;
  }

  on_byPlayer_cast(event) {
    if (event.ability.guid !== SPELLS.IRONFUR.id) {
      return;
    }

    const timestamp = event.timestamp;
    const hasGoE = this.combatants.selected.hasBuff(SPELLS.GUARDIAN_OF_ELUNE.id, timestamp);
    const duration = (this.ironfurDuration + (hasGoE ? GUARDIAN_OF_ELUNE_DURATION : 0)) * 1000;

    this.addStack(timestamp, timestamp + duration);
  }

  on_byPlayer_removebuff(event) {
    const spellId = event.ability.guid;
    if (SPELLS.BEAR_FORM.id === spellId) {
      const index = this.getMostRecentStackIndex(event.timestamp);
      this._stacksTimeline.length = index + 1;
      this._stacksTimeline.push({ timestamp: event.timestamp, stackCount: 0 });
    }
  }

  on_toPlayer_damage(event) {
    // Physical
    if (event.ability.type === SCHOOLS.ids.PHYSICAL) {
      const activeIFStacks = this.getStackCount(event.timestamp);
      this.registerHit(activeIFStacks);


      if (activeIFStacks > 0) {
        this.physicalHitsWithIronFur += 1;
        this.physicalDamageWithIronFur += event.amount + (event.absorbed || 0) + (event.overkill || 0);
      } else {
        this.physicalHitsWithoutIronFur += 1;
        this.physicalDamageWithoutIronFur += event.amount + (event.absorbed || 0) + (event.overkill || 0);
      }
    }
  }

  get ironfurStacksApplied() {
    return this._hitsPerStackCounter.slice(1).reduce((sum, x, i) => sum + (x * i), 0);
  }

  get totalHitsTaken() {
    return this._hitsPerStackCounter.reduce((sum, x) => sum + x, 0);
  }

  get overallIronfurUptime() {
    return this.ironfurStacksApplied / this.totalHitsTaken;
  }

  computeIronfurUptimeArray() {
    const totalHits = this.totalHitsTaken;
    return this._hitsPerStackCounter.map(hits => hits / totalHits);
  }

  on_finished() {
    if (debug) {
      console.log(`Hits with ironfur ${this.physicalHitsWithIronFur}`);
      console.log(`Damage with ironfur ${this.physicalDamageWithIronFur}`);
      console.log(`Hits without ironfur ${this.physicalHitsWithoutIronFur}`);
      console.log(`Damage without ironfur ${this.physicalDamageWithoutIronFur}`);
      console.log(`Total physical ${this.physicalDamageWithoutIronFur}${this.physicalDamageWithIronFur}`);
      console.log('Ironfur uptimes:', this.computeIronfurUptimeArray());
    }
  }

  suggestions(when) {
    const physicalDamageMitigatedPercent = this.physicalDamageWithIronFur / (this.physicalDamageWithIronFur + this.physicalDamageWithoutIronFur);

    when(physicalDamageMitigatedPercent).isLessThan(0.90)
      .addSuggestion((suggest, actual, recommended) => {
        return suggest(<span>You only had the <SpellLink id={SPELLS.IRONFUR.id} /> buff for {formatPercentage(actual)}% of physical damage taken. You should have the Ironfur buff up to mitigate as much physical damage as possible.</span>)
          .icon(SPELLS.IRONFUR.icon)
          .actual(`${formatPercentage(actual)}% was mitigated by Ironfur`)
          .recommended(`${Math.round(formatPercentage(recommended))}% or more is recommended`)
          .regular(recommended - 0.10).major(recommended - 0.2);
      });
  }

  statistic() {
    const totalIronFurTime = this.combatants.selected.getBuffUptime(SPELLS.IRONFUR.id);
    const physicalHitsMitigatedPercent = this.physicalHitsWithIronFur / (this.physicalHitsWithIronFur + this.physicalHitsWithoutIronFur);
    const physicalDamageMitigatedPercent = this.physicalDamageWithIronFur / (this.physicalDamageWithIronFur + this.physicalDamageWithoutIronFur);
    const uptimes = this.computeIronfurUptimeArray().reduce((str, uptime, stackCount) => {
      return str + `<li>${stackCount} stacks: ${formatPercentage(uptime)}%</li>`
    }, '');

    return (
      <StatisticBox
        icon={<SpellIcon id={SPELLS.IRONFUR.id} />}
        value={`${formatPercentage(physicalHitsMitigatedPercent)}% / ${this.overallIronfurUptime.toFixed(2)}`}
        label="Hits Mitigated with Ironfur / Average Stacks"
        tooltip={`Ironfur usage breakdown:
            <ul>
                <li>You were hit <b>${this.physicalHitsWithIronFur}</b> times with your Ironfur buff (<b>${formatThousands(this.physicalDamageWithIronFur)}</b> damage).</li>
                <li>You were hit <b>${this.physicalHitsWithoutIronFur}</b> times <b><i>without</i></b> your Ironfur buff (<b>${formatThousands(this.physicalDamageWithoutIronFur)}</b> damage).</li>
            </ul>
            <b>Stack count uptimes</b>
            <ul>
              ${uptimes}
            </ul>
            <b>${formatPercentage(physicalHitsMitigatedPercent)}%</b> of physical attacks were mitigated with Ironfur (<b>${formatPercentage(physicalDamageMitigatedPercent)}%</b> of physical damage taken), and your overall uptime was <b>${formatPercentage(totalIronFurTime / this.owner.fightDuration)}%</b>.`}
      />
    );
  }
  statisticOrder = STATISTIC_ORDER.CORE(10);
}

export default IronFur;
