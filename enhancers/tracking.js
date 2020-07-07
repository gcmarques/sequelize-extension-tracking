const _ = require('lodash');
const perfy = require('perfy');
const inflection = require('inflection');

let utils;

function changed(instance) {
  let changes;
  if (instance.changedWithVirtuals) {
    changes = instance.changedWithVirtuals();
  } else {
    changes = instance.changed();
  }
  return changes || [];
}

function start(trackingKey) {
  return perfy.start(trackingKey);
}
function end(trackingKey) {
  return perfy.end(trackingKey);
}

function getGlobalKey(model, as) {
  return `${utils.getName(model)}-${as}-tracking`;
}

function setScopeKey(model, options, key, as) {
  utils.setTriggerParams(options, `${utils.getName(model)}-${as}-tracking-scope`, { key });
}

function getScopeKey(model, options, as) {
  const { key } = utils.getTriggerParams(options, `${utils.getName(model)}-${as}-tracking-scope`);
  return `${as}-${utils.getName(model)}-tracking-${key !== undefined ? key : 1}`;
}

function getTrackingKey(model, options, as) {
  return `${utils.getName(model)}-${as}-${getScopeKey(model, options)}-${Math.random()}-${Date.now()}`;
}

function getVisibleAttributes(model) {
  return ['id'].concat(_.without(
    _.keys(utils.getRawAttributes(model)),
    'updatedAt', 'updatedBy', 'createdAt',
    'createdBy', 'deletedBy',
  ));
}

function differentKeys(obj1, obj2) {
  const keys = {};
  _.each(obj1, (v, key) => {
    if (!_.isEqual(v, obj2[key])) {
      keys[key] = 1;
    }
  });
  _.each(obj2, (v, key) => {
    if (!_.isEqual(v, obj1[key])) {
      keys[key] = 1;
    }
  });
  return _.keys(keys);
}

function pick(obj, keys) {
  const result = {};
  _.each(keys, (key) => {
    if (_.has(obj, key)) {
      result[key] = obj[key];
    } else {
      result[key] = '';
    }
  });
  return result;
}

const SETTER = /^(add|set|remove)/;
function isSetter(options) {
  const trigger = utils.getTriggerType(options);
  return SETTER.test(trigger);
}

const REMOVE_SETTER = /^remove/;
function isRemoveSetter(options) {
  const trigger = utils.getTriggerType(options);
  return REMOVE_SETTER.test(trigger);
}

const ADD_SETTER = /^add/;
function isAddSetter(options) {
  const trigger = utils.getTriggerType(options);
  return ADD_SETTER.test(trigger);
}

function safe(value, model) {
  const hiddenAttributes = model ? utils.getHiddenAttributes(model) : {};
  if (value === null) {
    return value;
  }
  if (_.isArray(value)) {
    const result = [];
    _.each(value, (_instance) => {
      const instance = {};
      _.each(_instance, (v, k) => {
        if (v !== undefined && v !== null && v !== '') {
          instance[k] = hiddenAttributes[k] ? '[redacted]' : v;
        }
      });
      result.push(instance);
    });
    return result;
  }
  const instance = {};
  _.each(value, (v, k) => {
    if (v !== undefined && v !== null && v !== '') {
      instance[k] = hiddenAttributes[k] ? '[redacted]' : v;
    }
  });
  return instance;
}

function getScope(model, association) {
  const sequelize = utils.getSequelize(model);
  const name = utils.getName(model);
  const target = utils.getAssociationTarget(association);
  const list = utils.isListAssociation(association);
  const as = utils.getAssociationAs(association);
  const attributes = getVisibleAttributes(target);
  const foreignKey = utils.getAssociationForeignKey(association);
  const get = async (id, transaction, original) => {
    const params = {
      attributes: ['id'],
      where: { id },
      include: [],
      transaction,
    };
    params.include.push({
      model: target,
      as,
      attributes,
    });
    const instance = await model.findOne(params);
    // if (!instance) {
    //   throw new Error(`Associated object not found: ${utils.getName(target)} -> ${name}-${id}`);
    // }
    if (original) {
      if (!instance) {
        return list ? [] : null;
      }
      return instance[as];
    }
    if (list) {
      return _.map(instance ? instance[as] : [], v => safe(_.pick(v, attributes), target));
    }
    return instance && instance[as] ? safe(_.pick(instance[as], attributes), target) : '';
  };
  return {
    name,
    target,
    list,
    as,
    get,
    attributes,
    foreignKey,
    sequelize,
  };
}

async function _wrappedBeforeUpdate(self, options, model) {
  const created = !self.id;
  const changes = changed(self);
  const trigger = utils.getTriggerType(options);
  const destroyed = trigger === 'DESTROY' || trigger === 'BULKDESTROY';
  if (changes.length || created || destroyed) {
    const trackingKey = getTrackingKey(model, options);
    start(trackingKey);
    const after = {};
    const before = {};
    _.each(changes, (key) => {
      after[key] = self[key];
      before[key] = self.previous(key);
    });
    utils.setTriggerParams(options, getScopeKey(model, options), {
      before, after, trackingKey,
    });
  } else {
    utils.setTriggerParams(options, getScopeKey(model, options), {});
  }
}

function beforeUpdate(model) {
  return async function wrappedBeforeUpdate(self, options) {
    if (isSetter(options)) {
      return;
    }
    return _wrappedBeforeUpdate(self, options, model);
  };
}

async function _wrappedAfterUpdate(self, options, model, name, attributes, log) {
  const { before, after, trackingKey } = utils.getTriggerParams(
    options,
    getScopeKey(model, options),
  );
  if (trackingKey) {
    const trigger = utils.getTriggerType(options);
    const destroyed = trigger === 'DESTROY' || trigger === 'BULKDESTROY';
    const safeBefore = safe(_.pick(before, attributes), model);
    const safeAfter = safe(_.pick(after, attributes), model);
    const keys = differentKeys(safeBefore, safeAfter);
    await log([{
      type: destroyed ? 'DELETE' : 'UPDATE',
      reference: `${name}-${self.id}`,
      data: {
        type: name,
        id: self.id,
        before: pick(safeBefore, keys),
        after: pick(safeAfter, keys),
      },
      executionTime: end(trackingKey).nanoseconds,
      userId: options.user.id,
    }], options);
  }
}

function afterUpdate(model, log) {
  const name = utils.getName(model);
  const attributes = getVisibleAttributes(model);
  return async function wrappedAfterUpdate(self, options) {
    if (isSetter(options)) {
      return;
    }
    return _wrappedAfterUpdate(self, options, model, name, attributes, log);
  };
}

function beforeBulkCreate(model) {
  return async function wrappedBeforeBulkCreate(instances, options) {
    if (isSetter(options)) {
      return;
    }
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(model, options, i);
      await _wrappedBeforeUpdate(instances[i], options, model);
    }
  };
}

function afterBulkCreate(model, log) {
  const name = utils.getName(model);
  const attributes = getVisibleAttributes(model);
  return async function wrappedAfterBulkCreate(instances, options) {
    if (isSetter(options)) {
      return;
    }
    const logs = [];
    const _log = m => Array.prototype.push.apply(logs, m);
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(model, options, i);
      await _wrappedAfterUpdate(instances[i], options, model, name, attributes, _log);
    }
    if (logs.length) {
      await log(logs, options);
    }
  };
}

function beforeBulkUpdate(model) {
  // const sequelize = utils.getSequelize(model);
  return async function wrappedBeforeBulkUpdate(options) {
    if (isSetter(options)) {
      return;
    }
    // if (!options.transaction) {
    //   const transaction = await sequelize.transaction();
    //   options.transaction = transaction;
    //   utils.setTriggerParams(options, getGlobalKey(model), { transaction });
    // }
    const instances = await utils.getBulkedInstances(model, options);
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(model, options, i);
      _.each(options.attributes, (value, key) => {
        instances[i].setDataValue(key, value);
      });
      await _wrappedBeforeUpdate(instances[i], options, model);
    }
  };
}

function afterBulkUpdate(model, log) {
  const name = utils.getName(model);
  const attributes = getVisibleAttributes(model);
  return async function wrappedAfterBulkUpdate(options) {
    if (isSetter(options)) {
      return;
    }
    const instances = await utils.getBulkedInstances(model, options);
    // const { transaction } = utils.getTriggerParams(options, getGlobalKey(model));
    // if (transaction) {
    //   try {
    //     await transaction.commit();
    //   } catch (err) {
    //     await transaction.rollback();
    //     throw err;
    //   }
    // }
    const logs = [];
    const _log = m => Array.prototype.push.apply(logs, m);
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(model, options, i);
      await _wrappedAfterUpdate(instances[i], options, model, name, attributes, _log);
    }
    if (logs.length) {
      await log(logs, options);
    }
  };
}

async function track(id, _instance, changes, state, scope, cache, transaction) {
  const instance = _instance.toJSON();
  if (!instance.id) {
    instance.id = _instance.tempId;
  }
  const cached = !!cache.id;
  if (!cached) {
    cache.id = id;
    cache.type = scope.name;
    cache.before = {};
    cache.after = {};
    cache.list = scope.list;
  }
  const { as, target, attributes } = scope;
  const { before, after } = cache;
  if (!cached) {
    before[as] = await scope.get(id, transaction);
    if (scope.list) {
      after[as] = {};
      after[as].length = 0;
      _.each(before[as], (v, i) => {
        after[as][v.id] = _.clone(v);
        after[as][v.id].__position = i;
        after[as].length += 1;
      });
    } else {
      after[as] = _.clone(before[as]);
    }
  }
  if (scope.list) {
    if (state === 'removed') {
      delete after[as][instance.id];
    } else if (state === 'added') {
      after[as][instance.id] = safe(_.pick(instance, attributes), target);
      after[as][instance.id].__position = after[as].length;
      after[as].length += 1;
    } else {
      _.extend(after[as][instance.id], safe(_.pick(instance, changes), target));
    }
  } else if (state === 'removed') {
    after[as] = '';
  } else if (state === 'added') {
    after[as] = safe(_.pick(instance, attributes), target);
  } else {
    _.extend(after[as], safe(_.pick(instance, changes), target));
  }
  return cache;
}

async function _wrappedBeforeUpdateAssociation(self, options, model, key, scope, cache, target) {
  const created = !self.id;
  const changes = changed(self);
  const trigger = utils.getTriggerType(options);
  const destroyed = trigger === 'DESTROY' || trigger === 'BULKDESTROY';

  if (!changes.length && !created && !destroyed) {
    return;
  }
  const scopeKey = getScopeKey(target, options, scope.as);
  if (created) {
    self.tempId = scopeKey;
  }
  const trackingKey = getTrackingKey(target, options, scope.as);
  let cacheId;
  let updates = [];
  const t = options.transaction;
  if (destroyed) {
    if (self[key]) {
      cacheId = self[key];
      cache[cacheId] = cache[cacheId] || {};
      updates.push(track(self[key], self, changes, 'removed', scope, cache[cacheId], t));
    }
  } else if (self[key] !== self.previous(key)) {
    if (self.previous(key)) {
      cacheId = self.previous(key);
      cache[cacheId] = cache[cacheId] || {};
      updates.push(track(self.previous(key), self, changes, 'removed', scope, cache[cacheId], t));
    }
    if (self[key]) {
      cacheId = self[key];
      cache[cacheId] = cache[cacheId] || {};
      updates.push(track(self[key], self, changes, 'added', scope, cache[cacheId], t));
    }
  } else if (self[key]) {
    cacheId = self[key];
    cache[cacheId] = cache[cacheId] || {};
    updates.push(track(self[key], self, changes, 'updated', scope, cache[cacheId], t));
  }
  if (updates.length) {
    start(trackingKey);
    updates = await Promise.all(updates);
  }
  utils.setTriggerParams(options, scopeKey, { updates, trackingKey, created });
}

function beforeUpdateAssociation(target, model, association, key) {
  const scope = getScope(model, association);
  return async function wrappedBeforeUpdateAssociation(self, options) {
    if (isSetter(options)) {
      return;
    }
    return _wrappedBeforeUpdateAssociation(self, options, model, key, scope, {}, target);
  };
}

async function _wrappedAfterUpdateAssociation(self, options, model, as, log) {
  const scopeKey = getScopeKey(model, options, as);
  const { updates, trackingKey, created } = utils.getTriggerParams(options, scopeKey);
  if (updates && updates.length) {
    const logs = [];
    const executionTime = end(trackingKey).nanoseconds;
    _.each(updates, (update) => {
      if (created) {
        if (!update.list && update.after[as]) {
          update.after[as].id = self.id;
        } else if (update.list && update.after[as][scopeKey]) {
          update.after[as][scopeKey].id = self.id;
        }
      }
      update.executionTime = executionTime;
      if (log) {
        if (update.list) {
          update.after[as] = _.sortBy(_.omit(update.after[as], 'length'), v => v.__position);
          update.after[as] = _.map(update.after[as], v => _.omit(v, '__position'));
        } else {
          update.before = safe(update.before);
          update.after = safe(update.after);
        }
        logs.push({
          type: 'UPDATE',
          reference: `${update.type}-${update.id}`,
          data: {
            type: update.type,
            id: update.id,
            before: update.before,
            after: update.after,
          },
          executionTime: update.executionTime,
          userId: options.user.id,
        });
      }
    });
    if (logs.length) {
      await log(logs, options);
    }
  }
}

function afterUpdateAssociation(model, as, log) {
  return async function wrappedAfterUpdateAssociation(self, options) {
    if (isSetter(options)) {
      return;
    }
    return _wrappedAfterUpdateAssociation(self, options, model, as, log);
  };
}

function beforeBulkUpdateAssociation(target, model, association, key) {
  const scope = getScope(model, association);
  return async function wrappedBeforeBulkUpdateAssociation(instances, options) {
    if (!options) {
      options = instances;
      instances = null;
    }
    if (isSetter(options)) {
      return;
    }
    // let transaction;
    if (instances === null) {
      // if (!options.transaction) {
      //   transaction = await scope.sequelize.transaction();
      //   options.transaction = transaction;
      //   utils.setTriggerParams(options, getGlobalKey(target, scope.as), { transaction });
      // }
      instances = await utils.getBulkedInstances(target, options);
      _.each(instances, (instance) => {
        _.each(options.attributes, (value, key) => {
          instance.setDataValue(key, value);
        });
      });
    }
    const cache = {};
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(target, options, i, scope.as);
      await _wrappedBeforeUpdateAssociation(
        instances[i], options, model,
        key, scope, cache, target,
      );
    }
    utils.setTriggerParams(options, getScopeKey(target, options, scope.as), { cache });
  };
}

function afterBulkUpdateAssociation(target, as, log) {
  return async function wrappedAfterBulkUpdateAssociation(instances, options) {
    if (!options) {
      options = instances;
      instances = null;
    }
    if (isSetter(options)) {
      return;
    }
    if (instances === null) {
      instances = await utils.getBulkedInstances(target, options);
    }
    // const { transaction } = utils.getTriggerParams(options, getGlobalKey(target, as));
    // if (transaction) {
    //   try {
    //     await transaction.commit();
    //   } catch (err) {
    //     await transaction.rollback();
    //     throw err;
    //   }
    // }
    const { cache } = utils.getTriggerParams(options, getScopeKey(target, options, as));
    const logs = [];
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(target, options, i, as);
      await _wrappedAfterUpdateAssociation(instances[i], options, target, as);
    }
    _.each(cache, (update) => {
      if (update.list) {
        update.after[as] = _.sortBy(_.omit(update.after[as], 'length'), v => v.__position);
        update.after[as] = _.map(update.after[as], v => _.omit(v, '__position'));
      } else {
        update.before = safe(update.before);
        update.after = safe(update.after);
      }
      logs.push({
        type: 'UPDATE',
        reference: `${update.type}-${update.id}`,
        data: {
          type: update.type,
          id: update.id,
          before: update.before,
          after: update.after,
        },
        executionTime: update.executionTime,
        userId: options.user.id,
      });
    });
    if (logs.length) {
      await log(logs, options);
    }
  };
}

function beforeNonThroughSetter(model, association) {
  const scope = getScope(model, association);
  return async function wrappedBeforeNonThroughSetter(self, values, options) {
    const isRemove = isRemoveSetter(options);
    const isAdd = isAddSetter(options);
    // if (!options.transaction) {
    //   const transaction = await scope.sequelize.transaction();
    //   options.transaction = transaction;
    //   utils.setTriggerParams(options, getGlobalKey(model, scope.as), { transaction });
    // }
    const { target, foreignKey } = scope;
    let before = await scope.get(self.id, options.transaction, true);
    if (!_.isArray(before)) {
      before = before === null ? [] : [before];
    }
    let after = [];
    if (values !== null) {
      if (!_.isArray(values)) {
        values = [values];
      }
      if (values.length) {
        if (utils.isInstance(values[0])) {
          values = _.map(values, v => v.id);
        }
        after = await target.findAll({
          where: { id: values },
          hooks: false,
          transaction: options.transaction,
        });
      }
    }
    const instances = [];
    _.each(before, (b) => {
      let found = false;
      _.each(after, (a) => {
        if (b.id === a.id) {
          if (isRemove) {
            b.setDataValue(foreignKey, null);
          } else {
            found = true;
          }
          a.found = true;
        }
      });
      if (!found) {
        if (!isRemove && !isAdd) {
          b.setDataValue(foreignKey, null);
        }
        instances.push(b);
      }
    });
    _.each(after, (a) => {
      if (!a.found) {
        a.setDataValue(foreignKey, self.id);
        instances.push(a);
      }
    });
    const cache = {};
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(model, options, i, scope.as);
      await _wrappedBeforeUpdateAssociation(
        instances[i], options, model,
        foreignKey, scope, cache, model,
      );
    }
    utils.setTriggerParams(options, getScopeKey(model, options, scope.as), { cache, instances });
  };
}

function afterNonThroughSetter(model, as, log) {
  return async function wrappedAfterBulkUpdateAssociation(self, values, options) {
    // const { transaction } = utils.getTriggerParams(options, getGlobalKey(model, as));
    // if (transaction) {
    //   try {
    //     await transaction.commit();
    //   } catch (err) {
    //     await transaction.rollback();
    //     throw err;
    //   }
    // }
    const { cache, instances } = utils.getTriggerParams(options, getScopeKey(model, options, as));
    const logs = [];
    for (let i = 0; i < instances.length; i += 1) {
      setScopeKey(model, options, i, as);
      await _wrappedAfterUpdateAssociation(instances[i], options, model, as);
    }
    _.each(cache, (update) => {
      if (update.list) {
        update.after[as] = _.sortBy(_.omit(update.after[as], 'length'), v => v.__position);
        update.after[as] = _.map(update.after[as], v => _.omit(v, '__position'));
      } else {
        update.before = safe(update.before);
        update.after = safe(update.after);
      }
      logs.push({
        type: 'UPDATE',
        reference: `${update.type}-${update.id}`,
        data: {
          type: update.type,
          id: update.id,
          before: update.before,
          after: update.after,
        },
        executionTime: update.executionTime,
        userId: options.user.id,
      });
    });
    if (logs.length) {
      await log(logs, options);
    }
  };
}

function beforeThroughSetter(model, association) {
  const scope = getScope(model, association);
  return async function wrappedBeforeThroughSetter(self, value, options) {
    // if (!options.transaction) {
    //   const transaction = await scope.sequelize.transaction();
    //   options.transaction = transaction;
    //   utils.setTriggerParams(options, getGlobalKey(model, scope.as), { transaction });
    // }
    const trackingKey = getTrackingKey(model, options, scope.as);
    start(trackingKey);
    const before = {};
    before[scope.as] = await scope.get(self.id, options.transaction);
    utils.setTriggerParams(options, getScopeKey(model, options, scope.as), {
      before, trackingKey, scope,
    });
  };
}

function afterThroughSetter(model, as, log) {
  return async function wrappedAfterThroughSetter(self, value, options) {
    // const { transaction } = utils.getTriggerParams(options, getGlobalKey(model, as));
    const { before, trackingKey, scope } = utils.getTriggerParams(
      options,
      getScopeKey(model, options, as),
    );
    const after = {};
    after[as] = await scope.get(self.id, options.transaction);
    // if (transaction) {
    //   try {
    //     await transaction.commit();
    //   } catch (err) {
    //     await transaction.rollback();
    //     throw err;
    //   }
    // }
    await log([{
      type: 'UPDATE',
      reference: `${scope.name}-${self.id}`,
      data: {
        type: scope.name,
        id: self.id,
        before,
        after,
      },
      executionTime: end(trackingKey).nanoseconds,
      userId: options.user.id,
    }], options);
  };
}

function beforeUpdateThroughAssociation(model, association, target, pairedAssociation) {
  const scope = getScope(model, association);
  const targetScope = getScope(target, pairedAssociation);
  return async function wrappedBeforeUpdateThroughAssociation(instances, options) {
    if (!options) {
      options = instances;
      instances = null;
    }
    if (isSetter(options)) {
      return;
    }
    // if (!options.transaction) {
    //   const transaction = await scope.sequelize.transaction();
    //   options.transaction = transaction;
    //   utils.setTriggerParams(options, getGlobalKey(model, scope.as), { transaction });
    // }
    if (instances === null) {
      instances = await utils.getBulkedInstances(model, options);
    } else if (!_.isArray(instances)) {
      instances = [instances];
    }
    let targets = [];
    for (let i = 0; i < instances.length; i += 1) {
      const parents = await scope.get(instances[i].id, options.transaction, true);
      Array.prototype.push.apply(targets, parents);
    }
    targets = _.uniqBy(targets, 'id');
    for (let i = 0; i < targets.length; i += 1) {
      setScopeKey(model, options, i, scope.as);
      const trackingKey = getTrackingKey(model, options, scope.as);
      start(trackingKey);
      const before = {};
      before[targetScope.as] = await targetScope.get(targets[i].id, options.transaction);
      utils.setTriggerParams(options, getScopeKey(model, options, scope.as), {
        before, trackingKey, targetScope,
      });
    }
    utils.setTriggerParams(options, getGlobalKey(model, scope.as), { targets });
  };
}

function afterUpdateThroughAssociation(model, log, as) {
  return async function wrappedBeforeUpdateThroughAssociation(instances, options) {
    if (!options) {
      options = instances;
      instances = null;
    }
    if (isSetter(options)) {
      return;
    }
    const { targets } = utils.getTriggerParams(options, getGlobalKey(model, as));
    const logs = [];
    for (let i = 0; i < targets.length; i += 1) {
      setScopeKey(model, options, i, as);
      const {
        before,
        trackingKey,
        targetScope,
      } = utils.getTriggerParams(options, getScopeKey(model, options, as));
      const after = {};
      after[targetScope.as] = await targetScope.get(targets[i].id, options.transaction);
      logs.push({
        type: 'UPDATE',
        reference: `${targetScope.name}-${targets[i].id}`,
        data: {
          type: targetScope.name,
          id: targets[i].id,
          before,
          after,
        },
        executionTime: end(trackingKey).nanoseconds,
        userId: options.user.id,
      });
    }
    // if (transaction) {
    //   try {
    //     await transaction.commit();
    //   } catch (err) {
    //     await transaction.rollback();
    //     throw err;
    //   }
    // }
    if (logs.length) {
      await log(logs, options);
    }
  };
}

function enhanceModel(model, hooks, settings) {
  if (!utils.isVirtualModel(model)) {
    const name = utils.getName(model);
    const modelOptions = utils.getOptions(model);
    const associations = utils.getAssociations(model);

    let { log } = settings;
    if (!_.isFunction(log)) {
      log = async logs => _.each(logs, log => global.console.log(log));
    }

    _.each(associations, (association) => {
      // Add setter hooks:
      // addTask, addTasks, removeTask, removeTasks, setTask, setTasks
      if (utils.getAssociationOptions(association).extendHistory) {
        const as = utils.getAssociationAs(association);
        const singular = _.upperFirst(inflection.singularize(as));
        if (!utils.hasThroughAssociation(association)) {
          if (utils.isListAssociation(association)) {
            const plural = _.upperFirst(inflection.pluralize(as));
            if (singular !== plural) {
              hooks[name][`beforeAdd${singular}`].push(beforeNonThroughSetter(model, association));
              hooks[name][`afterAdd${singular}`].push(afterNonThroughSetter(model, as, log));
              hooks[name][`beforeRemove${singular}`].push(beforeNonThroughSetter(model, association));
              hooks[name][`afterRemove${singular}`].push(afterNonThroughSetter(model, as, log));
            }
            hooks[name][`beforeAdd${plural}`].push(beforeNonThroughSetter(model, association));
            hooks[name][`afterAdd${plural}`].push(afterNonThroughSetter(model, as, log));
            hooks[name][`beforeRemove${plural}`].push(beforeNonThroughSetter(model, association));
            hooks[name][`afterRemove${plural}`].push(afterNonThroughSetter(model, as, log));
            hooks[name][`beforeSet${plural}`].push(beforeNonThroughSetter(model, association));
            hooks[name][`afterSet${plural}`].push(afterNonThroughSetter(model, as, log));
          } else {
            hooks[name][`beforeSet${singular}`].push(beforeNonThroughSetter(model, association));
            hooks[name][`afterSet${singular}`].push(afterNonThroughSetter(model, as, log));
          }
        } else if (utils.isListAssociation(association)) {
          const plural = _.upperFirst(inflection.pluralize(as));
          if (singular !== plural) {
            hooks[name][`beforeAdd${singular}`].push(beforeThroughSetter(model, association));
            hooks[name][`afterAdd${singular}`].push(afterThroughSetter(model, as, log));
            hooks[name][`beforeRemove${singular}`].push(beforeThroughSetter(model, association));
            hooks[name][`afterRemove${singular}`].push(afterThroughSetter(model, as, log));
          }
          hooks[name][`beforeAdd${plural}`].push(beforeThroughSetter(model, association));
          hooks[name][`afterAdd${plural}`].push(afterThroughSetter(model, as, log));
          hooks[name][`beforeRemove${plural}`].push(beforeThroughSetter(model, association));
          hooks[name][`afterRemove${plural}`].push(afterThroughSetter(model, as, log));
          hooks[name][`beforeSet${plural}`].push(beforeThroughSetter(model, association));
          hooks[name][`afterSet${plural}`].push(afterThroughSetter(model, as, log));
        } else {
          hooks[name][`beforeSet${singular}`].push(beforeThroughSetter(model, association));
          hooks[name][`afterSet${singular}`].push(afterThroughSetter(model, as, log));
        }
      }

      // Add update hooks for BelongsTo associations. If Project has Task and Task is
      // updated, it should be logged in Project (if extendHistory is TRUE).
      if (utils.hasThroughAssociation(association)) {
        const pairedAssociation = association.paired;
        if (pairedAssociation && utils.getAssociationOptions(pairedAssociation).extendHistory) {
          const as = utils.getAssociationAs(association);
          const target = utils.getAssociationTarget(association);
          const beforeHandler = beforeUpdateThroughAssociation(
            model,
            association,
            target,
            pairedAssociation,
          );
          const afterHandler = afterUpdateThroughAssociation(model, log, as);
          hooks[name].beforeUpdate.push(beforeHandler);
          hooks[name].afterUpdate.push(afterHandler);
          hooks[name].beforeDestroy.push(beforeHandler);
          hooks[name].afterDestroy.push(afterHandler);
          hooks[name].beforeBulkUpdate.push(beforeHandler);
          hooks[name].afterBulkUpdate.push(afterHandler);
          hooks[name].beforeBulkDestroy.push(beforeHandler);
          hooks[name].afterBulkDestroy.push(afterHandler);
        }
      } else {
        const foreignKey = utils.getAssociationForeignKey(association);
        let pairedAssociation = null;
        _.each(utils.getAssociations(utils.getAssociationTarget(association)), (a) => {
          const target = utils.getAssociationTarget(a);
          const targetForeignKey = utils.getAssociationForeignKey(a);
          if (utils.getName(target) === name && targetForeignKey === foreignKey) {
            pairedAssociation = a;
          }
        });
        if (pairedAssociation && utils.getAssociationOptions(pairedAssociation).extendHistory) {
          if (utils.isBelongsToAssociation(association)) {
            const as = utils.getAssociationAs(pairedAssociation);
            const target = utils.getAssociationTarget(association);
            const beforeHandler = beforeUpdateAssociation(
              model, target,
              pairedAssociation, foreignKey,
            );
            const afterHandler = afterUpdateAssociation(model, as, log);
            const beforeBulkHandler = beforeBulkUpdateAssociation(
              model,
              target,
              pairedAssociation,
              foreignKey,
            );
            const afterBulkHandler = afterBulkUpdateAssociation(model, as, log);
            hooks[name].beforeCreate.push(beforeHandler);
            hooks[name].afterCreate.push(afterHandler);
            hooks[name].beforeUpdate.push(beforeHandler);
            hooks[name].afterUpdate.push(afterHandler);
            hooks[name].beforeDestroy.push(beforeHandler);
            hooks[name].afterDestroy.push(afterHandler);
            hooks[name].beforeBulkCreate.push(beforeBulkHandler);
            hooks[name].afterBulkCreate.push(afterBulkHandler);
            hooks[name].beforeBulkUpdate.push(beforeBulkHandler);
            hooks[name].afterBulkUpdate.push(afterBulkHandler);
            hooks[name].beforeBulkDestroy.push(beforeBulkHandler);
            hooks[name].afterBulkDestroy.push(afterBulkHandler);
          } else {
            const as = utils.getAssociationAs(association);
            const target = utils.getAssociationTarget(association);
            const beforeHandler = beforeUpdateThroughAssociation(
              model,
              association,
              target,
              pairedAssociation,
            );
            const afterHandler = afterUpdateThroughAssociation(model, log, as);
            hooks[name].beforeUpdate.push(beforeHandler);
            hooks[name].afterUpdate.push(afterHandler);
            hooks[name].beforeDestroy.push(beforeHandler);
            hooks[name].afterDestroy.push(afterHandler);
            hooks[name].beforeBulkUpdate.push(beforeHandler);
            hooks[name].afterBulkUpdate.push(afterHandler);
            hooks[name].beforeBulkDestroy.push(beforeHandler);
            hooks[name].afterBulkDestroy.push(afterHandler);
          }
        }
      }
    });

    if (modelOptions.history) {
      hooks[name].beforeCreate.push(beforeUpdate(model));
      hooks[name].afterCreate.push(afterUpdate(model, log));
      hooks[name].beforeUpdate.push(beforeUpdate(model));
      hooks[name].afterUpdate.push(afterUpdate(model, log));
      hooks[name].beforeDestroy.push(beforeUpdate(model));
      hooks[name].afterDestroy.push(afterUpdate(model, log));
      hooks[name].beforeBulkCreate.push(beforeBulkCreate(model));
      hooks[name].afterBulkCreate.push(afterBulkCreate(model, log));
      hooks[name].beforeBulkUpdate.push(beforeBulkUpdate(model));
      hooks[name].afterBulkUpdate.push(afterBulkUpdate(model, log));
      hooks[name].beforeBulkDestroy.push(beforeBulkUpdate(model));
      hooks[name].afterBulkDestroy.push(afterBulkUpdate(model, log));
    }
  }
}

function enhanceTracking(_options) {
  return function enhance(db, hooks, settings) {
    /* eslint-disable-next-line */
    utils = settings.utils;
    const options = _.extend({}, settings, _options);
    _.each(db, (model) => {
      if (utils.isModel(model)) {
        enhanceModel(model, hooks, options);
      }
    });
  };
}

module.exports = enhanceTracking;
