# sequelize-extension-tracking

[![Build Status](https://travis-ci.org/gcmarques/sequelize-extension-tracking.svg?branch=master)](https://travis-ci.org/gcmarques/sequelize-extension-tracking)
[![codecov](https://codecov.io/gh/gcmarques/sequelize-extension/branch/master/graph/badge.svg)](https://codecov.io/gh/gcmarques/sequelize-extension-tracking)
![GitHub license](https://img.shields.io/github/license/gcmarques/sequelize-extension-tracking.svg)

### Installation
```bash
$ npm install --save sequelize-extension-tracking
```

### Usage

This library uses [sequelize-extension](https://www.npmjs.com/package/sequelize-extension) to add tracking to sequelize instance updates. You can define what models will be tracked using the option `history` and you can define what associated fields will be tracked using `extendHistory` option when creating the association. `extendHistory` is `false` by default.
```javascript
const Project = sequelize.define('project', {
  name: DataTypes.STRING(255),
}, { 
  history: true 
});
const Task = sequelize.define('project', {
  name: DataTypes.STRING(255),
}, { 
  history: false 
});
const User = sequelize.define('project', {
  username: DataTypes.STRING(255),
}, { 
  history: false 
});
Task.belongsTo(Project);
User.belongsToMany(Project, { through: 'userProjects' });
Project.belongsToMany(User, { through: 'userProjects', extendHistory: true });
Project.hasMany(Task, { extendHistory: true });

extendSequelize(db, {
  tracking: { log: console.log }
});

const project = await Project.create({ name: 'My Project' });
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
const user = await User.create({ username: 'gabriel@test.com' });
await project.addUser(user);
// [
//   reference: 'project-1',
//   ...
//     before: { users: [] },
//     after: { users: [{ id: 1, username: 'gabriel@test.com' }] }
//   ...
// ]
const task = await Task.create({ name: 'Test', projectId: 1 });
// [
//   reference: 'project-1',
//   ...
//     before: { tasks: [] },
//     after: { tasks: [{ id: 1, name: 'Test'}] }
//   ...
// ]
```


### Other Extensions
[sequelize-extension-createdBy](https://www.npmjs.com/package/sequelize-extension-createdBy) - Automatically set createdBy with user.
[sequelize-extension-updatedBy](https://www.npmjs.com/package/sequelize-extension-updatedBy) - Automatically set updatedBy with user.id option.
[sequelize-extension-deletedBy](https://www.npmjs.com/package/sequelize-extension-deletedBy) - Automatically set deletedBy with user.id option.
[sequelize-extension-graphql](https://www.npmjs.com/package/sequelize-extension-graphql) - Create GraphQL schema based on sequelize models.