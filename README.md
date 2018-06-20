# sequelize-extension-tracking

[![Build Status](https://travis-ci.org/gcmarques/sequelize-extension-tracking.svg?branch=master)](https://travis-ci.org/gcmarques/sequelize-extension-tracking)
[![codecov](https://codecov.io/gh/gcmarques/sequelize-extension-tracking/branch/master/graph/badge.svg)](https://codecov.io/gh/gcmarques/sequelize-extension-tracking)
![GitHub license](https://img.shields.io/github/license/gcmarques/sequelize-extension-tracking.svg)

### Installation
```bash
$ npm install --save sequelize-extension-tracking
```

### Usage

This library uses [sequelize-extension](https://www.npmjs.com/package/sequelize-extension) to add tracking to sequelize instance updates. You can define what models will be tracked using the option `history` and you can define what associated fields will be tracked using `extendHistory` option when creating the association. `extendHistory` is `false` by default.
```javascript
const Sequelize = require('sequelize');
const extendSequelize = require('sequelize-extension');
const enhanceTracking = require('sequelize-extension-tracking');

const sequelize = new Sequelize(...);

const db = {};
db.Project = sequelize.define('project', {
  name: Sequelize.STRING(255),
}, { 
  history: true 
});
db.Task = sequelize.define('task', {
  name: Sequelize.STRING(255),
}, { 
  history: false 
});
db.User = sequelize.define('user', {
  username: Sequelize.STRING(255),
}, { 
  history: false 
});
db.Task.belongsTo(Project);
db.User.belongsToMany(Project, { through: 'userProjects' });
db.Project.belongsToMany(User, { through: 'userProjects', extendHistory: true });
db.Project.hasMany(Task, { extendHistory: true });

extendSequelize(db, {
  tracking: enhanceTracking({
    log: logs => console.log(logs),
  }),
});

const project = await db.Project.create({ name: 'My Project' });
// [
//   type: 'UPDATE',
//   reference: 'project-1',
//   data: {
//     id: 1,
//     type: 'project',
//     before: {},
//     after: { name: 'My Project' }
//   },
//   executionTime: 1000 (nanoseconds)
// ]
const user = await db.User.create({ username: 'gabriel@test.com' });
await project.addUser(user);
// [
//   reference: 'project-1',
//   ...
//     before: { users: [] },
//     after: { users: [{ id: 1, username: 'gabriel@test.com' }] }
//   ...
// ]
const task = await db.Task.create({ name: 'Test', projectId: 1 });
// [
//   reference: 'project-1',
//   ...
//     before: { tasks: [] },
//     after: { tasks: [{ id: 1, name: 'Test'}] }
//   ...
// ]
```

### Logging in the database
```javascript
const Sequelize = require('sequelize');
const extendSequelize = require('sequelize-extension');
const enhanceTracking = require('sequelize-extension-tracking');

const sequelize = new Sequelize(...);

const db = {};
db.Log = sequelize.define('log', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: Sequelize.BIGINT,
  },
  type: {
    allowNull: false,
    type: Sequelize.ENUM('UPDATE', 'ERROR', 'REQUEST', 'DELETE'),
  },
  reference: {
    allowNull: true,
    type: Sequelize.STRING(64),
  },
  data: {
    allowNull: false,
    type: Sequelize.TEXT,
  },
  executionTime: {
    allowNull: true,
    type: Sequelize.FLOAT,
  },
  createdAt: {
    allowNull: true,
    type: Sequelize.DATE,
  },
}, {
  timestamps: true,
  updatedAt: false,
  tableName: 'logs',
  freezeTableName: true,
  history: false, // make sure the logging table has no history
});

db.Log.log = async function log(values, options) {
  values.forEach((v) => {
    v.data = JSON.stringify(v.data);
  });
  return this.bulkCreate(values, { transaction: options.transaction });
};

// ...

extendSequelize(db, {
  tracking: enhanceTracking({
    log: async (logs, options) => {
      return db.Log.log(logs, options);
    },
  }),
});
```


### Other Extensions
[sequelize-extension-createdby](https://www.npmjs.com/package/sequelize-extension-createdby) - Automatically set `createdBy` with `options.user.id` option.\
[sequelize-extension-updatedby](https://www.npmjs.com/package/sequelize-extension-updatedby) - Automatically set `updatedBy` with `options.user.id` option.\
[sequelize-extension-deletedby](https://www.npmjs.com/package/sequelize-extension-deletedby) - Automatically set `deletedBy` with `options.user.id` option.\
[sequelize-extension-graphql](https://www.npmjs.com/package/sequelize-extension-graphql) - Create GraphQL schema based on sequelize models.\
[sequelize-extension-view](https://www.npmjs.com/package/sequelize-extension-view) - Models with the method `createViews` will be called to create table views (virtual models).
