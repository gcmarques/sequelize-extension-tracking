const _ = require('lodash');
const extendSequelize = require('sequelize-extension');
const enhanceTracking = require('../../');
const connection = require('../helpers/connection');
const dropAll = require('../helpers/dropAll');

const TEST = n => `TEST_${n}`;
function OPTIONS() {
  return { user: { id: 2 } };
}

describe('enhancers', () => {
  let sequelize;
  let db;
  let logs;
  const logger = {
    log: async (entries) => { logs = logs.concat(entries); },
  };

  const omit = (values, ...keys) => _.map(values, v => _.omit(v, ...keys));

  const reset = async () => {
    await dropAll(sequelize);
    db = {};
    db.user = sequelize.define('user', {
      username: sequelize.Sequelize.STRING(255),
    }, {
      history: true,
      paranoid: true,
      updatedAt: false,
      createdAt: false,
    });
    db.task = sequelize.define('task', {
      title: sequelize.Sequelize.STRING(255),
    }, {
      paranoid: true,
      updatedAt: false,
      createdAt: false,
    });
    db.avatar = sequelize.define('avatar', {
      title: sequelize.Sequelize.STRING(255),
    }, {
      paranoid: true,
      updatedAt: false,
      createdAt: false,
    });
    db.project = sequelize.define('project', {
      name: sequelize.Sequelize.STRING(255),
    }, {
      paranoid: true,
      updatedAt: false,
      createdAt: false,
    });
    db.task.belongsTo(db.user);
    db.user.hasMany(db.task, { extendHistory: true });
    db.avatar.belongsTo(db.user);
    db.user.hasOne(db.avatar, { extendHistory: true });
    db.user.belongsToMany(db.project, {
      through: 'userProjects',
      extendHistory: true,
    });
    db.project.belongsToMany(db.user, { through: 'userProjects' });
    await sequelize.sync();
  };

  before(async () => {
    sequelize = connection();
    await reset();
    extendSequelize(db, {
      tracking: enhanceTracking({
        log: async (entries) => {
          await logger.log(entries);
        },
      }),
    });
  });

  after(async () => {
    sequelize.close();
  });

  describe('-> tracking:', () => {
    it('should track when instances are created', async () => {
      logs = [];
      await db.user.create({ username: TEST(1) }, OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {},
          after: { username: TEST(1) },
        },
        userId: 2,
      }]);
    });

    it('should track when instances are bulk created', async () => {
      logs = [];
      await db.user.bulkCreate([
        { username: TEST(2) },
        { username: TEST(2) },
      ], OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {},
          after: { username: TEST(2) },
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-3',
        data: {
          id: 3,
          type: 'user',
          before: {},
          after: { username: TEST(2) },
        },
        userId: 2,
      }]);
    });

    it('should track when instances are updated', async () => {
      logs = [];
      const user = await db.user.findById(1);
      user.username = TEST(3);
      await user.save(OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: { username: TEST(1) },
          after: { username: TEST(3) },
        },
        userId: 2,
      }]);
    });

    it('should track when instances are bulk updated', async () => {
      logs = [];
      await db.user.update({
        username: TEST(4),
      }, _.extend({
        where: { username: TEST(2) },
      }, OPTIONS()));
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: { username: TEST(2) },
          after: { username: TEST(4) },
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-3',
        data: {
          id: 3,
          type: 'user',
          before: { username: TEST(2) },
          after: { username: TEST(4) },
        },
        userId: 2,
      }]);
    });

    it('should track when instances are destroyed', async () => {
      const user = await db.user.create({
        username: TEST(4),
      });
      logs = [];
      await user.destroy(OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'DELETE',
        reference: 'user-4',
        data: {
          id: 4,
          type: 'user',
          before: {},
          after: {},
        },
        userId: 2,
      }]);
    });

    it('should track when instances are bulk destroyed', async () => {
      await db.user.bulkCreate([
        { username: TEST(4) },
        { username: TEST(4) },
      ]);
      logs = [];
      await db.user.destroy(_.extend({
        where: { id: [5, 6] },
      }, OPTIONS()));
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'DELETE',
        reference: 'user-5',
        data: {
          id: 5,
          type: 'user',
          before: {},
          after: {},
        },
        userId: 2,
      }, {
        type: 'DELETE',
        reference: 'user-6',
        data: {
          id: 6,
          type: 'user',
          before: {},
          after: {},
        },
        userId: 2,
      }]);
    });

    it('should track when associated instances are created (1:1)', async () => {
      logs = [];
      await db.avatar.create({
        title: TEST(5),
        userId: 1,
      }, OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {},
          after: { avatar: { id: 1, title: TEST(5), userId: 1 } },
        },
        userId: 2,
      }]);
    });

    it('should track when associated instances are bulk created (1:1)', async () => {
      logs = [];
      await db.avatar.bulkCreate([
        { title: TEST(6), userId: 2 },
        { title: TEST(6), userId: 3 },
      ], OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {},
          after: {
            avatar: { id: 2, title: TEST(6), userId: 2 },
          },
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-3',
        data: {
          id: 3,
          type: 'user',
          before: {},
          after: {
            avatar: { id: 3, title: TEST(6), userId: 3 },
          },
        },
        userId: 2,
      }]);
    });

    it('should track when associated instances are updated (1:1)', async () => {
      logs = [];
      const avatar = await db.avatar.findById(1);
      avatar.title += '-changed';
      await avatar.save(OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {
            avatar: { id: 1, title: TEST(5), userId: 1 },
          },
          after: {
            avatar: { id: 1, title: `${TEST(5)}-changed`, userId: 1 },
          },
        },
        userId: 2,
      }]);
    });

    it('should track when associated instances are bulk updated (1:1)', async () => {
      logs = [];
      await db.avatar.update({
        title: TEST(1),
      }, _.extend({
        where: { id: [1, 2] },
      }, OPTIONS()));
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {
            avatar: { id: 1, title: `${TEST(5)}-changed`, userId: 1 },
          },
          after: {
            avatar: { id: 1, title: TEST(1), userId: 1 },
          },
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            avatar: { id: 2, title: TEST(6), userId: 2 },
          },
          after: {
            avatar: { id: 2, title: TEST(1), userId: 2 },
          },
        },
        userId: 2,
      }]);
    });

    it('should track when associated instances are destroyed (1:1)', async () => {
      logs = [];
      const avatar = await db.avatar.findById(1);
      await avatar.destroy(OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {
            avatar: { id: 1, title: TEST(1), userId: 1 },
          },
          after: {},
        },
        userId: 2,
      }]);
    });

    it('should track when associated instances are bulk destroyed (1:1)', async () => {
      logs = [];
      await db.avatar.destroy(_.extend({
        where: { id: { ne: null } },
      }, OPTIONS()));
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            avatar: { id: 2, title: TEST(1), userId: 2 },
          },
          after: {},
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-3',
        data: {
          id: 3,
          type: 'user',
          before: {
            avatar: { id: 3, title: TEST(6), userId: 3 },
          },
          after: {},
        },
        userId: 2,
      }]);
    });

    it('should track when associated instances are set (1:1)', async () => {
      const user = await db.user.findById(3);
      await db.avatar.create({ title: TEST(7), userId: 2 });
      logs = [];
      await user.setAvatar(4, OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            avatar: { id: 4, title: TEST(7), userId: 2 },
          },
          after: {},
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-3',
        data: {
          id: 3,
          type: 'user',
          before: {},
          after: {
            avatar: { id: 4, title: TEST(7), userId: 3 },
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are created (1:m)', async () => {
      logs = [];
      await db.task.create({
        title: TEST(5),
        userId: 1,
      }, OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: { tasks: [] },
          after: { tasks: [{ id: 1, title: TEST(5), userId: 1 }] },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are bulk created (1:m)', async () => {
      logs = [];
      await db.task.bulkCreate([
        { title: TEST(6), userId: 1 },
        { title: TEST(6), userId: 1 },
        { title: TEST(6), userId: 2 },
      ], OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {
            tasks: [
              { id: 1, title: TEST(5), userId: 1 },
            ],
          },
          after: {
            tasks: [
              { id: 1, title: TEST(5), userId: 1 },
              { id: 2, title: TEST(6), userId: 1 },
              { id: 3, title: TEST(6), userId: 1 },
            ],
          },
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [],
          },
          after: {
            tasks: [
              { id: 4, title: TEST(6), userId: 2 },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are updated (1:m)', async () => {
      logs = [];
      const task = await db.task.findById(1);
      task.userId = 2;
      await task.save(OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {
            tasks: [
              { id: 1, title: TEST(5), userId: 1 },
              { id: 2, title: TEST(6), userId: 1 },
              { id: 3, title: TEST(6), userId: 1 },
            ],
          },
          after: {
            tasks: [
              { id: 2, title: TEST(6), userId: 1 },
              { id: 3, title: TEST(6), userId: 1 },
            ],
          },
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [
              { id: 4, title: TEST(6), userId: 2 },
            ],
          },
          after: {
            tasks: [
              { id: 4, title: TEST(6), userId: 2 },
              { id: 1, title: TEST(5), userId: 2 },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are bulk updated (1:m)', async () => {
      logs = [];
      await db.task.update({
        userId: 2,
      }, _.extend({
        where: { id: { ne: null } },
      }, OPTIONS()));
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-1',
        data: {
          id: 1,
          type: 'user',
          before: {
            tasks: [
              { id: 2, title: TEST(6), userId: 1 },
              { id: 3, title: TEST(6), userId: 1 },
            ],
          },
          after: {
            tasks: [],
          },
        },
        userId: 2,
      }, {
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [
              { id: 1, title: TEST(5), userId: 2 },
              { id: 4, title: TEST(6), userId: 2 },
            ],
          },
          after: {
            tasks: [
              { id: 1, title: TEST(5), userId: 2 },
              { id: 4, title: TEST(6), userId: 2 },
              { id: 2, title: TEST(6), userId: 2 },
              { id: 3, title: TEST(6), userId: 2 },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are destroyed (1:m)', async () => {
      logs = [];
      const task = await db.task.findById(1);
      await task.destroy(OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [
              { id: 1, title: TEST(5), userId: 2 },
              { id: 2, title: TEST(6), userId: 2 },
              { id: 3, title: TEST(6), userId: 2 },
              { id: 4, title: TEST(6), userId: 2 },
            ],
          },
          after: {
            tasks: [
              { id: 2, title: TEST(6), userId: 2 },
              { id: 3, title: TEST(6), userId: 2 },
              { id: 4, title: TEST(6), userId: 2 },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are bulk destroyed (1:m)', async () => {
      logs = [];
      await db.task.destroy(_.extend({
        where: { id: { ne: null } },
      }, OPTIONS()));
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [
              { id: 2, title: TEST(6), userId: 2 },
              { id: 3, title: TEST(6), userId: 2 },
              { id: 4, title: TEST(6), userId: 2 },
            ],
          },
          after: {
            tasks: [],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are set (1:m)', async () => {
      const user = await db.user.findById(2);
      const task = await db.task.create({ title: TEST(8) });
      logs = [];
      await user.setTasks([task], OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [],
          },
          after: {
            tasks: [
              { id: 5, title: TEST(8), userId: 2 },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are added (1:m)', async () => {
      const user = await db.user.findById(2);
      await db.task.create({ title: TEST(8) });
      logs = [];
      await user.addTask(6, OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [
              { id: 5, title: TEST(8), userId: 2 },
            ],
          },
          after: {
            tasks: [
              { id: 5, title: TEST(8), userId: 2 },
              { id: 6, title: TEST(8), userId: 2 },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are removed (1:m)', async () => {
      const user = await db.user.findById(2);
      logs = [];
      await user.removeTasks([5, 6], OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            tasks: [
              { id: 5, title: TEST(8), userId: 2 },
              { id: 6, title: TEST(8), userId: 2 },
            ],
          },
          after: {
            tasks: [],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are set (n:m)', async () => {
      const user = await db.user.findById(2);
      const project = await db.project.create({ name: TEST(9) });
      logs = [];
      await user.setProjects([project], OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            projects: [],
          },
          after: {
            projects: [
              { id: 1, name: TEST(9) },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are added (n:m)', async () => {
      const user = await db.user.findById(2);
      const project = await db.project.create({ name: TEST(10) });
      logs = [];
      await user.addProjects([project], OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            projects: [
              { id: 1, name: TEST(9) },
            ],
          },
          after: {
            projects: [
              { id: 1, name: TEST(9) },
              { id: 2, name: TEST(10) },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are removed (n:m)', async () => {
      const user = await db.user.findById(2);
      logs = [];
      await user.removeProject(2, OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            projects: [
              { id: 1, name: TEST(9) },
              { id: 2, name: TEST(10) },
            ],
          },
          after: {
            projects: [
              { id: 1, name: TEST(9) },
            ],
          },
        },
        userId: 2,
      }]);
    });

    it('should track when list associated instances are updated (n:m)', async () => {
      const project = await db.project.findById(1);
      logs = [];
      project.name += '-changed';
      await project.save(OPTIONS());
      expect(omit(logs, 'executionTime')).to.deep.equal([{
        type: 'UPDATE',
        reference: 'user-2',
        data: {
          id: 2,
          type: 'user',
          before: {
            projects: [
              { id: 1, name: TEST(9) },
            ],
          },
          after: {
            projects: [
              { id: 1, name: `${TEST(9)}-changed` },
            ],
          },
        },
        userId: 2,
      }]);
    });
  });
});
