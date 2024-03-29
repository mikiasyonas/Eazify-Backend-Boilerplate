/* eslint-disable max-len */
const _ = require('lodash');
const {emailEvent} = require('../../subscribers/send_email_confirmation');

const {createToken} = require('../../utils/token');

const {serverLogger} = require('../../helpers/logger/serverLogger');
const {compareHash, hashText} = require('../../utils/hashGenerators');
const {BAD_REQUEST} = require('../../helpers/constants/statusCodes');
const runDatabaseQuery = require('../../helpers/handlers/makdeDatabaseOperation');

const userSignUp = async (
    expressParams,
    prisma,
    {
      sendSuccessResponse,
    },
) => {
  const userData = expressParams.req.body;

  const confirmationCode = (Math.floor(10000 + Math.random() * 900000))
      .toString();

  const hashedPassword = await hashText(userData.password);

  userData.password = hashedPassword;
  userData.confirmation_code = confirmationCode;


  // Database actions take up here
  const user = await runDatabaseQuery(prisma.user.create({
    data: {
      ...userData,
    },
  }));

  const token = await createToken(user, expressParams.req, prisma);

  user.accessToken = token;

  serverLogger.info(`User With Id ${user.id} Successfully Registered`);
  emailEvent.emit('user_regsistered', user);

  return sendSuccessResponse(
      _.pick(user,
          [
            '_id',
            'first_name',
            'last_name',
            'username',
            'email',
            'phone_number',
            'accessToken',
          ],
      ), 'User Saved To Database');
};

const userSignIn = async (
    expressParams,
    prisma,
    {
      sendSuccessResponse,
      sendErrorResponse,
    },
) => {
  const userData = expressParams.req.body;
  const user = await prisma.user.findUnique({
    where: {
      username: userData.username,
    },
  });

  if (!user) {
    return sendErrorResponse(400, {
      message: 'User not found',
    });
  }

  const correctPassword = await compareHash(userData.password, user.password);

  if (!correctPassword) {
    return sendErrorResponse(400, 'Password incorrect');
  }

  const token = await createToken(user, expressParams.req, prisma);

  user.accessToken = token;

  serverLogger.info(`User With Id ${user.id} Successfully Logged In`);

  return sendSuccessResponse(
      _.pick(user,
          [
            'id',
            'first_name',
            'last_name',
            'email',
            'accessToken',
          ],
      ), 'Successful Login');
};

const showUserLogins = async (
    expressParams,
    prisma,
    {
      sendErrorResponse,
      sendSuccessResponse,
    },
) => {
  const userId = expressParams.req.user.id;
  const tokenId = expressParams.req.user.tokenId;

  const userLogins = await prisma.userLogin.findMany({
    where: {
      user_id: userId,
    },
  });

  let current = false;

  const logins = [];

  userLogins.forEach(async (login) => {
    current = false;
    if (tokenId == login.token_id) {
      current = true;
    }

    login.current = current;
    logins.push(login);
  });

  return sendSuccessResponse(userLogins);
};

const deleteUserLogin = async (
    expressParams,
    prisma,
    {
      sendErrorResponse,
      sendSuccessResponse,
    },
) => {
  const loginId = expressParams.req.params.login_id;

  await prisma.userLogin.update({
    where: {
      id: parseInt(loginId),
    },
    data: {
      token_deleted: true,
    },
  });

  return sendSuccessResponse('Token successfully deleted!');
};

const deleteAllUserLogins = async (
    expressParams,
    prisma,
    {
      sendSuccessResponse,
      sendErrorResponse,
    },
) => {
  const userDetail = expressParams.req.user;
  await prisma.user.update({
    where: {
      id: parseInt(userDetail.id),
    },
    data: {
      user_logins: {
        updateMany: {
          where: {
            user_id: userDetail.id,
          },
          data: {
            token_deleted: true,
          },
        },
      },
    },
  });

  return sendSuccessResponse('Successfully deleted all logins!');
};

const deleteAllUserLoginsExceptCurrent = async (
    expressParams,
    prisma,
    {
      sendSuccessResponse,
      sendErrorResponse,
    },
) => {
  const userDetail = expressParams.req.user;

  const userLogins = await prisma.userLogin.findMany({
    where: {
      user_id: userDetail.id,
    },
  });

  // eslint-disable-next-line prefer-const
  let current = false;

  userLogins.forEach(async (login) => {
    current = false;

    if (userDetail.tokenId === login.token_id) {
      current = true;
    }

    if (!current) {
      await prisma.userLogin.update({
        where: {
          token_id: login.token_id,
        },
        data: {
          token_deleted: true,
          logged_out: true,
        },
      });
    }
  });

  return sendSuccessResponse('Token deleted except current!');
};

const verifyAccount = async (
    expressParams,
    prisma,
    {
      sendErrorResponse,
      sendSuccessResponse,
    },
) => {
  const {confirmationCode} = expressParams.req.body;
  const userDetail = expressParams.req.user;

  const user = await prisma.user.findUnique({
    where: {
      id: userDetail.id,
    },
  });

  if (!user) {
    return sendErrorResponse(BAD_REQUEST, 'User not found');
  }

  if (user.confirmation_code !== confirmationCode) {
    return sendErrorResponse(BAD_REQUEST, 'Confirmation code not correct');
  }

  await prisma.user.update({
    where: {
      id: userDetail.id,
    },
    data: {
      Activated: true,
      confirmation_code: '',
    },
  });

  return sendSuccessResponse(
      { },
      'Account activated!');
};

const changePassword = async (
    expressParams,
    prisma,
    {
      sendErrorResponse,
      sendSuccessResponse,
    },
) => {
  const userDetails = expressParams.req.user;

  const user = await prisma.user.findUnique({
    where: {
      id: userDetails.id,
    },
  });

  const {newPassword, oldPassword} = expressParams.req.body;

  if (compareHash(oldPassword, user.password)) {
    const newHashedPassword = await hashText(newPassword);
    await prisma.user.update({
      where: {
        id: userDetails.id,
      },
      data: {
        password: newHashedPassword,
      },
    });

    return sendSuccessResponse({ }, 'Successfully changed password');
  } else {
    return sendErrorResponse(
        BAD_REQUEST,
        'Passwords do not match');
  }
};


module.exports = {
  userSignUp,
  userSignIn,
  showUserLogins,
  deleteUserLogin,
  deleteAllUserLogins,
  deleteAllUserLoginsExceptCurrent,
  verifyAccount,
  changePassword,
};
