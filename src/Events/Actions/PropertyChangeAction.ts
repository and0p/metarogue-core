import { 
  Action, IEntity, Component, Value, ActionParameters
} from '../../internal';

export class PropertyChangeAction extends Action {
  property: string;
  type: 'adjust' | 'set';
  value: 'current' | 'min' | 'max';
  amount: number;
  finalAmount: number;
  adjustments: { amount: number, by?: IEntity | Component }[] = [];
  multipliers: { amount: number, by?: IEntity | Component }[] = [];

  constructor({ caster, target, property, type = 'adjust', value = 'current', amount, using, tags }: PropertyChangeAction.Params) {
    super({caster, using, tags});
    this.target = target;
    this.property = property;
    this.type = type;
    this.value = value;
    this.amount = amount;
    this.finalAmount = amount;
  }

  apply(): boolean {
    this.calculate();
    const { target, property, type, finalAmount } = this;
    const p = this.target?.properties.get(property);
    // See if we have this property
    if(p) {
      // Figure out which value we're adjusting (current, min, or max)
      let v: Value;
      switch(this.value) {
        case 'min':
          v = p.min;
          break;
        case 'max':
          v = p.max;
          break;
        default:
          v = p.current;
          break;
      }
      // Either adjust or set this number
      type === 'adjust' ? v._adjust(finalAmount) : v._set(finalAmount);
      return true;
    }
    return false;
  }

  calculate(): number { 
    this.adjustments.map(adjustment => this.finalAmount += adjustment.amount);
    this.multipliers.map(multiplier => this.finalAmount *= multiplier.amount);
    return this.finalAmount;
  }

  adjust(amount: number, by?: IEntity | Component, breadcrumbs?: string[], unique?: boolean) {
    // TODO this logic should be lifted up into Action itself
    if(breadcrumbs) {
      // If unique, make sure we haven't already applied an adjustment with any of these tags
      if(unique && breadcrumbs.some(r => this.breadcrumbs.has(r))) {
        return;
      }
      breadcrumbs.map(s => this.breadcrumbs.add(s));
    }
    this.adjustments.push({ amount, by });
  }

  multiply(amount: number, by?: IEntity | Component, breadcrumbs?: string[], unique?: boolean) {
    if(breadcrumbs) {
      // If unique, make sure we haven't already applied an adjustment with any of these tags
      if(unique && breadcrumbs.some(r => this.breadcrumbs.has(r))) {
        return;
      }
      breadcrumbs.map(s => this.breadcrumbs.add(s));
    }
    this.multipliers.push({ amount, by });
  }

  effects(key: string): boolean {
    return key === this.property;
  }

  increases(key: string): boolean {
    return this.effects(key)&& this.amount > 0;
  }

  decreases(key: string): boolean {
    return this.effects(key) && this.amount < 0;
  }

  buffs(key: string): boolean {
    return this.effects(key)&& this.amount > 0;
  }

  damages(key: string): boolean {
    return this.effects(key) && this.amount < 0;
  }

}

export namespace PropertyChangeAction {	
  export interface ValueParams extends ActionParameters {	
    amount: number,	
  }	

  export interface Params extends ValueParams {	
    target: IEntity,	
    property: string,	
    value?: 'current' | 'min' | 'max',	
    type?: 'adjust' | 'set'	
  }	
}