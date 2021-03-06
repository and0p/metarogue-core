import {
  IEntity,
  Action, World, Component,
  Modifier, Reacter, isModifier, isReacter,
  Player, Team, ActionQueue, Entity, PublishEntityAction, Vector, UnpublishEntityAction, Command, ClientGame
} from "../internal";
import { VisibilityType } from '../Events/Enums';
import { ActionQueuer, Viewer } from "./Interfaces";
import { CONNECTION, CONNECTION_RESPONSE } from "../ClientServer/Message";

export abstract class Game {
  static instance: Game;
  name: string = "New Game";

  worlds: Map<string, World> = new Map<string, World>();
  entities: Map<string, IEntity> = new Map<string, IEntity>();

  teams: Map<string, Team> = new Map<string, Team>();
  teamsByName: Map<string, Team> = new Map<string, Team>();
  players: Map<string, Player> = new Map<string, Player>();
  playersWithoutTeams = new Map<string, Player>();

  components: Component[] = []; // all components
  modifiers: Modifier[] = [];   // all modifiers
  reacters: Reacter[] = [];     // all reacters

  actionQueue = new ActionQueue();

  viewDistance = 6; // how far (in chunks) to load around active entities
  inactiveViewDistance = 1; // how far (in chunks) to load around inactive entities when they enter an inactive world to check for permissions / modifiers
  perceptionGrouping: "player" | "team" = "player";

  constructor(options?: any) {
    if (Game.instance && !process.env.DEBUG) {
      throw new Error();
    }
    Game.instance = this;
  }

  static getInstance = (): Game => {
    if (Game.instance) {
      return Game.instance;
    }
    throw new Error();
  }

  // process = (command: Command): boolean => {
  //   const { player: playerId, entity: entityId, params } = command;
  //   // See if the player exists
  //   const player = this.players.get(command.player);
  //   if(player === undefined) {
  //     return false;
  //   }
  //   // See if the entity is specified, and if the player has rights on it
  //   let entity;
  //   if(command.entity) {
  //     entity = this.getEntity(command.entity);
  //     if(entity === undefined) {
  //       return false;
  //     }
  //   }
  //   this.queueForBroadcast(a);
  //   return true;
  // }

  addWorld = (world: World): boolean => {
    this.worlds.set(world.id, world);
    return true;
  }

  getWorld = (id: string): World | undefined => {
    return this.worlds.get(id);
  }

  getEntity = (id: string): IEntity | undefined => {
    return this.entities.get(id);
  }

  addEntity(e: IEntity): boolean {
    this.entities.set(e.id, e);
    if(e.world && this.worlds.has(e.world.id)) {
      e.world.addEntity(e);
    }
    return true;
  }

  removeEntity(e: IEntity): boolean {
    this.entities.delete(e.id);
    if(e.world) {
      e.world.removeEntity(e);
    }
    return true;
  }

  attach(c: Component): boolean {
    this.components.push(c); // TODO check for unique flag, return false if already attached
    if (isModifier(c)) {
      this.modifiers.push(c);
    }
    if (isReacter(c)) {
      this.reacters.push(c);
    }
    return true;
  }

  detach(c: Component): void {
    // TODO
  }

  modify(a: Action) {
    this.modifiers.map(r => r.modify(a));
  }

  react(a: Action) {
    this.reacters.map(r => r.react(a));
  }

  queueForBroadcast(action: Action) {
    // Check what the perception level is, ie do teams percieve actions as a whole or individual players?
    if (this.perceptionGrouping === 'team') {
      // Loop through teams and broadcast if visible
      for (const team of this.teams.values()) {
        this.enqueueForTeam(action, team);
      }
      // Also broadcast to any players without teams, falling back to player-level perception
      for(const player of this.playersWithoutTeams.values()) {
        this.enqueueForPlayer(action, player);
      }
    } else if (this.perceptionGrouping === 'player') {
      // Loop through all players
      for (const player of this.players.values()) {
        this.enqueueForPlayer(action, player);
      }
    }
  }

  enqueueForTeam(action: Action, team: Team) {
    // Only care if team has players
    if(team.players.size === 0) {
      return;
    }
    // Let the team visibility function determine if it passes, fails, or defers the visibility check to each member IEntity
    let visibility: VisibilityType = this.getVisibilityToTeam(action, team);
    // If not deferring, broadcast with resolved visibility
    if (visibility !== VisibilityType.DEFER) {
      if(visibility > VisibilityType.NOT_VISIBLE) {
        this.percieveAndEnqueue(action, team, visibility);
      }
      return;
    }
    // If deferred, we have to check at the player level and take the highest visibility found
    // (breaking immediately if full visibility is determined at any point)
    visibility = VisibilityType.DEFER;
    for (const playerId of team.players) {
      const player = this.players.get(playerId);
      if (player) {
        const playerVisibility = Game.determineVisibilityCheckHeirarchy(visibility, this.getVisibilityToPlayer(action, player));
        if(playerVisibility === VisibilityType.VISIBLE) {
          this.percieveAndEnqueue(action, team, visibility);
          continue;
        }
      }
    }
    if(visibility !== VisibilityType.DEFER) {
      this.percieveAndEnqueue(action, team, visibility);
    }
    // If deferred again, check for visibility on each individual IEntity
    // Note that we don't use DEFER, since it's not possible to defer any further
    visibility = VisibilityType.NOT_VISIBLE;
    for (const entityId of team.entities) {
      const IEntity = this.entities.get(entityId);
      if (IEntity) {
        const entityVisibility = Game.determineVisibilityCheckHeirarchy(visibility, this.getVisibilityToEntity(action, IEntity));
        if(entityVisibility === VisibilityType.VISIBLE) {
          this.percieveAndEnqueue(action, team, visibility);
          continue;
        }
      }
    }
    // Broadcast if visible in any way to any IEntity on this team
    if(visibility > VisibilityType.NOT_VISIBLE) {
      this.percieveAndEnqueue(action, team, visibility);
    }
  }

  enqueueForPlayer(action: Action, player: Player) {
    // Check at the player level and take the highest visibility found
    // (breaking immediately if full visibility is determined at any point)
    let visibility = Game.determineVisibilityCheckHeirarchy(VisibilityType.DEFER, this.getVisibilityToPlayer(action, player));
    if (visibility !== VisibilityType.DEFER) {
      if (visibility > VisibilityType.NOT_VISIBLE) {
        this.percieveAndEnqueue(action, player, visibility);
      }
      return;
    }
    // If deferred, check for visibility on each individual IEntity
    // Note that we don't use DEFER, since it's not possible to defer any further
    visibility = VisibilityType.NOT_VISIBLE;
    for (const entityId in player.entities) {
      const IEntity = this.entities.get(entityId);
      if (IEntity) {
        visibility = Game.determineVisibilityCheckHeirarchy(visibility, this.getVisibilityToEntity(action, IEntity));
        if (visibility === VisibilityType.VISIBLE) {
          continue;
        }
      }
    }
    if (visibility >= VisibilityType.NOT_VISIBLE) {
      this.percieveAndEnqueue(action, player, visibility);
    }
  }

  // Determines if one visibility type is "more visible" than another, for example NOT_VISIBLE < VISIBLE
  // Also conveniently combines TARGET_VISIBLE and CASTER_VISIBLE into (fully) VISIBLE
  static determineVisibilityCheckHeirarchy(currentHighest: VisibilityType, newVisibility: VisibilityType) {
    if ((currentHighest === VisibilityType.CASTER_UNKNOWN && newVisibility === VisibilityType.TARGET_UNKNOWN) ||
      (currentHighest === VisibilityType.TARGET_UNKNOWN && newVisibility === VisibilityType.CASTER_UNKNOWN)) {
         return VisibilityType.VISIBLE;
    }
    return currentHighest < newVisibility ? newVisibility : currentHighest;
  }

  percieveAndEnqueue(a: Action, viewer: Player | Team, visibility: VisibilityType = VisibilityType.VISIBLE) {
    const serializedNormally = a.serialize();
    // TODO percieve

    // Check if this is an action that could affect entity/world scope
    if(a.visibilityChangingAction) {
      const movingEntity = a.getEntity();
      const id = movingEntity !== undefined ? movingEntity.id : undefined;
      // See if we're gaining visibility and prepend this broadcast with a publish if so
      if(movingEntity && id && visibility >= VisibilityType.VISIBLE && !viewer.getEntitiesInSight().has(id)) {
        viewer.entitiesInSight.add(id);
        this.percieveAndEnqueue(new PublishEntityAction({ entity: movingEntity, world: movingEntity.world!, position: movingEntity.position }), viewer);
      }
      // Broadcast action itself
      viewer.enqueueAction(a, visibility, JSON.stringify(serializedNormally));
      // Publish if appropriate
      if(movingEntity && id &&visibility === VisibilityType.LOSES_VISION && viewer.getEntitiesInSight().has(id)) {
        viewer.entitiesInSight.delete(id);  // TODO woah, super naive
        this.percieveAndEnqueue(new UnpublishEntityAction({ entity: movingEntity }), viewer);
      }
    } else {
      viewer.enqueueAction(a, visibility, JSON.stringify(serializedNormally));
    }
  }

  // Optionally modify underlying serialized method to customize it for a team or player.
  // Return undefined if no modification is necessary
  percieve(a: Action, viewer: Player | Team, visibility: VisibilityType): string | undefined {
    return undefined;
  }

  getVisibilityToTeam(a: Action, t: Team): VisibilityType {
    const relevantEntity = a.getEntity();
    if((a.caster && t.entities.has(a.caster.id)) || (relevantEntity && t.entities.has(relevantEntity.id))) {
      return VisibilityType.VISIBLE;
    }
    return a.isInPlayerOrTeamScope(t) ? VisibilityType.VISIBLE : VisibilityType.NOT_VISIBLE;
  }

  getVisibilityToPlayer(a: Action, p: Player): VisibilityType {
    const relevantEntity = a.getEntity();
    if((a.caster && p.entities.has(a.caster.id)) || (relevantEntity && p.entities.has(relevantEntity.id))) {
      return VisibilityType.VISIBLE;
    }
    return a.isInPlayerOrTeamScope(p) ? VisibilityType.VISIBLE : VisibilityType.NOT_VISIBLE;
  }

  getVisibilityToEntity(a: Action, e: IEntity): VisibilityType {
    if(a.caster === e || a.target === e) {
      return VisibilityType.VISIBLE;
    }
    return VisibilityType.VISIBLE;
  }

  abstract onPlayerConnect(msg: CONNECTION): CONNECTION_RESPONSE;
  abstract onPlayerDisconnect(options: any): void;  // TODO solidify disconnection options w/ interface in ClientServer

  serializeForScope(viewer: Viewer): Game.SerializedForClient {
    const o: Game.SerializedForClient = { name: this.name, players: [], teams: [], worlds: [], entities: [] }
    // Serialize all players
    for(let player of this.players.values()) {
      o.players.push(player.serializeForClient());
    }
    // Serialize all teams
    for(let team of this.teams.values()) {
      o.teams.push(team.serializeForClient());
    }
    // Gather all visible worlds and serialize with visible baselayer chunks
    for(let kv of viewer.getWorldScopes()) {
      const world = this.worlds.get(kv[0]);
      if(world !== undefined) {
        o.worlds.push(world.serializeForClient());
      }
    }
    // Gather all entities in sight
    for(let entityId of viewer.getEntitiesInSight()) {
      const entity = this.entities.get(entityId);
      if(entity !== undefined) {
        o.entities.push(entity.serializeForClient());
      }
    }
    return o;
  }
}

export namespace Game {
  export interface SerializedForClient {
    name: string,
    // config?: any,  // TODO make config interface, GameConfiguration.ts or something
    players: Player.SerializedForClient[],
    teams: Team.SerializedForClient[],
    worlds: World.SerializedForClient[],
    entities: Entity.SerializedForClient[]
  }

  export function DeserializeAsClient(serialized: Game.SerializedForClient): ClientGame {
    const game = new ClientGame();
    for(let team of serialized.teams) {
      const deserialized = Team.DeserializeAsClient(team);
      game.teams.set(deserialized.id, deserialized);  // TODO addTeam
    }
    for(let player of serialized.players) {
      const deserialized = Player.DeserializeAsClient(player);
      game.players.set(deserialized.id, deserialized);  // TODO addPlayer..
    }
    for(let world of serialized.worlds) {
      const deserialized = World.deserializeAsClient(world);
      game.addWorld(deserialized);
    }
    for(let entity of serialized.entities) {
      const deserialized = Entity.DeserializeAsClient(entity);
      game.addEntity(deserialized);
    }
    return game;
  }
}
