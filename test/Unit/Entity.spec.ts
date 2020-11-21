import { expect } from 'chai';
import 'mocha';
import Ability from '../../src/EntityComponent/Ability';

import Entity from '../../src/EntityComponent/Entity';

import EmptyAbility from '../Mocks/Abilities/Empty';
import Heal from '../Mocks/Abilities/Heal';

describe('Entity', () => {

});

describe('Entity action/event generators', () => {
  let e: Entity;
  let heal: Ability;
  beforeEach(() => { 
    e = new Entity();
    heal = new Heal();
    e._grant(heal, e, e);
  });

  describe('Casting', () => {
    it('Generates an event for an ability it does have', () => {
      expect(e.cast(heal.name, { using: e })).to.exist;
    });
    
    it('Does not generate and event for an ability it does not have', () => {
      expect(e.cast("blah")).to.be.undefined;
    });
  });
});

describe('Entity action direct methods', () => {
  let e: Entity;
  beforeEach(() => { e = new Entity(); });

  describe('Granting abilities', () => {
    const ability = new EmptyAbility();
    it('Can be granted a single ability.', () => {
      // Granting single ability
      expect(e.abilities.size).to.equal(0);
      expect(e._grant(ability, undefined, undefined)).to.be.true;
      expect(e.abilities.size).to.equal(1);
      const grant = e.abilities.get(ability.name);
      expect(grant).to.exist;
      if(grant) { // typescript compile safety
        expect(grant.length).to.equal(1);
      }
    });
    
    it('Cannot be granted duplicate abilities.', () => {
      expect(e.abilities.size).to.equal(0);
      // Attempt to grant the same ability the same way multiple times
      expect(e._grant(ability, undefined, undefined)).to.be.true;
      expect(e._grant(ability, undefined, undefined)).to.be.false;
      expect(e._grant(ability, undefined, undefined)).to.be.false;
      expect(e._grant(ability, undefined, undefined)).to.be.false;
      expect(e.abilities.size).to.equal(1);
      const grant = e.abilities.get(ability.name);
      expect(grant).to.exist;
      if(grant) { // typescript compile safety
        expect(grant.length).to.equal(1);
      }
    });
    
    it('Can be granted the same ability using different entities or components.', () => {
      expect(e.abilities.size).to.equal(0);
      const someOtherEntity = new Entity();
      expect(e._grant(ability, undefined, undefined)).to.be.true;
      expect(e._grant(ability, someOtherEntity, someOtherEntity)).to.be.true;
      const grant = e.abilities.get(ability.name);
      expect(grant).to.exist;
      if(grant) { // typescript compile safety
        expect(grant.length).to.equal(2);
      }
    });

  });

  describe('Denying (removing) abilities', () => {
    const ability = new EmptyAbility();
    const someOtherEntity = new Entity();

    // Give the entity some abilities to deny for every test
    beforeEach(() => { 
      e._grant(ability, undefined, undefined);
      e._grant(ability, someOtherEntity, someOtherEntity);
    });

    it('Can deny an ability using or granted by one source.', () => {
      // Remove one 
      expect(e._deny(ability, undefined, undefined)).to.be.true;
      expect(e.abilities.size).to.equal(1);
      const grant = e.abilities.get(ability.name);
      expect(grant).to.exist;
      if(grant) { // typescript compile safety
        expect(grant.length).to.equal(1);
      }
    });

    it('Can deny an entire ability by denying both sources.', () => {
      // Remove one 
      expect(e._deny(ability, undefined, undefined)).to.be.true;
      expect(e._deny(ability, someOtherEntity, someOtherEntity)).to.be.true;
      expect(e.abilities.size).to.equal(0);
      // Check both methods for seeing if an entity has an ability
      const grant = e.abilities.get(ability.name);
      expect(grant).to.not.exist;
      expect(e.can(ability.name)).to.be.false;
    });
  });

  describe('Adding slots', () => {
    const slotName = "Head";
    const slots = ["Head", "Chest", "Hands", "Legs", "Feet"];

    it('Grants a single slot', () => {
      expect(e.slots.size).to.equal(0);
      expect(e._addSlot(slotName)).to.be.true;
      expect(e.slots.size).to.equal(1);
      expect(e.slots.has(slotName)).to.be.true;
    });

    it('Fails to grant an existing slot', () => {
      expect(e.slots.size).to.equal(0);
      expect(e._addSlot(slotName)).to.be.true;
      expect(e._addSlot(slotName)).to.be.false;
      expect(e.slots.size).to.equal(1);
    });

    it('Can grant multiple slots', () => {
      expect(e.slots.size).to.equal(0);
      slots.map(slot => {
        expect(e._addSlot(slot)).to.be.true;
      });
      expect(e.slots.size).to.equal(slots.length);
    });
  });

  describe('Removing slots', () => {
    const slotName = "Head";
    const slots = ["Head", "Chest", "Hands", "Legs", "Feet"];

    // Grant some default slots
    beforeEach(() => {
      slots.map(slot => {
        e._addSlot(slot);
      });
    });

    it('Can remove a single slot', () => {
      expect(e._removeSlot(slotName)).to.be.true;
      expect(e.slots.has(slotName)).to.be.false;
      expect(e.slots.size).to.equal(slots.length - 1);
    });

    it('Cannot remove a nonexistant slot', () => {
      expect(e._removeSlot("randomstringakldfjklsjflksjf")).to.be.false;
    });
  });

  describe('Equipping items', () => {
    const mainSlot = "Head";
    const slots = ["Head", "Chest", "Hands", "Legs", "Feet"];
    const item = new Entity();

    beforeEach(() => {
      slots.map(slot => {
        e._addSlot(slot);
      });
    });

    it('Can equip an item', () => {
      expect(e.slots.get(mainSlot)).to.be.undefined;
      expect(e._equip(item, mainSlot)).to.be.true;
      expect(e.slots.get(mainSlot)).to.be.equal(item);
    });

    it('Cannot equip an item into an occupied slot', () => {
      e._equip(item, mainSlot);
      expect(e._equip(item, mainSlot)).to.be.false;
    });
  });
});
