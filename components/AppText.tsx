import React from 'react';
import { Text, TextProps } from 'react-native';
import FONT_CAP, { FontCapTier } from '@/constants/typography';

export interface AppTextProps extends TextProps {
  /** Caps Dynamic-Type scaling per tier. Defaults to 'dense' — the safe default
   *  for this card-heavy app. Pass maxFontSizeMultiplier={0} to disable the cap. */
  variant?: FontCapTier;
}

const AppText = React.forwardRef<React.ComponentRef<typeof Text>, AppTextProps>(
  ({ variant = 'dense', ...rest }, ref) => (
    <Text ref={ref} maxFontSizeMultiplier={FONT_CAP[variant]} {...rest} />
  )
);

AppText.displayName = 'AppText';

export default AppText;
