import styled, { css } from 'styled-components';

const Level = styled.p`
  padding: 0.3rem 1.2rem;
  border-radius: var(--border-radius-lg);
  font-weight: 500;
  font-size: 1.5rem;

  ${props =>
    props.level === 'easy' &&
    css`
      background-color: var(--color-green-100);
    `}

  ${props =>
    props.level === 'medium' &&
    css`
      background-color: var(--color-yellow-100);
    `}

    ${props =>
    props.level === 'hard' &&
    css`
      background-color: var(--color-red-100);
    `}
`;

export default Level;
